use crate::db;
use crate::email_parse;
use std::collections::HashMap;

struct RawEmail {
    id: i64,
    message_id: String,
    in_reply_to: Option<String>,
    references: Option<Vec<String>>,
    subject: Option<String>,
    received_at: i64,
    is_read: bool,
    is_flagged: bool,
}

pub struct ThreadingService;

impl ThreadingService {
    pub fn new() -> Self {
        ThreadingService
    }

    pub fn rebuild_threads_for_account(&self, account_id: i64) -> Result<(), String> {
        let emails = self.fetch_unthreaded_emails(account_id)?;

        let threads = self.build_threads(&emails);

        self.persist_threads(account_id, &threads, &emails)?;

        Ok(())
    }

    fn fetch_unthreaded_emails(&self, account_id: i64) -> Result<Vec<RawEmail>, String> {
        let conn = db::get()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, message_id, in_reply_to, \"references\", subject, received_at, is_read, labels \
                 FROM emails WHERE account_id = ?1",
            )
            .map_err(|e| e.to_string())?;

        let emails: Vec<RawEmail> = stmt
            .query_map(rusqlite::params![account_id], |row| {
                let refs_str: Option<String> = row.get(3)?;
                let refs: Option<Vec<String>> = refs_str
                    .as_deref()
                    .and_then(|s| serde_json::from_str(s).ok());
                let labels_str: String = row.get(7)?;
                let labels: Vec<String> = serde_json::from_str(&labels_str).unwrap_or_default();
                Ok(RawEmail {
                    id: row.get(0)?,
                    message_id: row.get(1)?,
                    in_reply_to: row.get(2)?,
                    references: refs,
                    subject: row.get(4)?,
                    received_at: row.get(5)?,
                    is_read: row.get::<_, i64>(6)? != 0,
                    is_flagged: labels.iter().any(|l| l == "\\Flagged"),
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        Ok(emails)
    }

    fn build_threads(&self, emails: &[RawEmail]) -> Vec<Vec<i64>> {
        let mut msg_id_to_idx: HashMap<String, usize> = HashMap::new();
        for (idx, email) in emails.iter().enumerate() {
            msg_id_to_idx.insert(email.message_id.clone(), idx);
        }

        let mut parent: Vec<Option<usize>> = vec![None; emails.len()];
        let mut children: Vec<Vec<usize>> = vec![Vec::new(); emails.len()];

        for (idx, email) in emails.iter().enumerate() {
            let parent_idx = self.find_parent(email, &msg_id_to_idx);
            if let Some(pi) = parent_idx {
                if pi != idx && !self.would_cycle(idx, pi, &parent) {
                    parent[idx] = Some(pi);
                    children[pi].push(idx);
                }
            }
        }

        let mut threads: Vec<Vec<i64>> = Vec::new();
        for root in 0..emails.len() {
            if parent[root].is_some() {
                continue;
            }
            let mut thread: Vec<i64> = Vec::new();
            self.collect_thread_iter(root, &children, &mut thread);
            thread.sort_by_key(|&i| emails[i as usize].received_at);
            threads.push(thread);
        }

        threads
    }

    fn find_parent(
        &self,
        email: &RawEmail,
        msg_id_to_idx: &HashMap<String, usize>,
    ) -> Option<usize> {
        if let Some(ref refs) = email.references {
            if let Some(last_ref) = refs.last() {
                if let Some(&idx) = msg_id_to_idx.get(last_ref) {
                    return Some(idx);
                }
            }
        }

        if let Some(ref irt) = email.in_reply_to {
            if let Some(&idx) = msg_id_to_idx.get(irt) {
                return Some(idx);
            }
        }

        None
    }

    fn would_cycle(&self, child: usize, proposed_parent: usize, parent: &[Option<usize>]) -> bool {
        let mut current = proposed_parent;
        loop {
            if current == child {
                return true;
            }
            match parent[current] {
                Some(p) => current = p,
                None => return false,
            }
        }
    }

    fn collect_thread_iter(
        &self,
        node: usize,
        children: &[Vec<usize>],
        thread: &mut Vec<i64>,
    ) {
        let mut stack = vec![node];
        while let Some(n) = stack.pop() {
            thread.push(n as i64);
            for &child in &children[n] {
                stack.push(child);
            }
        }
    }

    fn persist_threads(
        &self,
        account_id: i64,
        threads: &[Vec<i64>],
        emails: &[RawEmail],
    ) -> Result<(), String> {
        let mut conn = db::get()?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        tx.execute(
            "DELETE FROM threads WHERE account_id = ?1",
            rusqlite::params![account_id],
        )
        .map_err(|e| e.to_string())?;

        {
            let mut insert_thread = tx.prepare(
                "INSERT INTO threads (account_id, subject, latest_date, message_count, is_read, is_flagged) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            ).map_err(|e| e.to_string())?;
            let mut update_email = tx.prepare(
                "UPDATE emails SET thread_id = ?1 WHERE id = ?2",
            ).map_err(|e| e.to_string())?;

            for thread_indices in threads {
                if thread_indices.is_empty() {
                    continue;
                }

                let subject = emails[thread_indices[0] as usize]
                    .subject
                    .as_ref()
                    .map(|s| email_parse::decode_header(s))
                    .unwrap_or_default();

                let latest_date = thread_indices
                    .iter()
                    .map(|&i| emails[i as usize].received_at)
                    .max()
                    .unwrap_or(0);

                let message_count = thread_indices.len() as i64;

                let is_read = thread_indices.iter().all(|&i| emails[i as usize].is_read);

                let is_flagged = thread_indices.iter().any(|&i| emails[i as usize].is_flagged);

                insert_thread.execute(rusqlite::params![
                    account_id,
                    subject,
                    latest_date,
                    message_count,
                    is_read as i64,
                    is_flagged as i64,
                ]).map_err(|e| e.to_string())?;

                let thread_id = tx.last_insert_rowid();

                for &idx in thread_indices {
                    let email_id = emails[idx as usize].id;
                    update_email.execute(rusqlite::params![thread_id, email_id])
                        .map_err(|e| e.to_string())?;
                }
            }
        }

        tx.commit().map_err(|e| e.to_string())?;

        Ok(())
    }
}

use crate::db;

pub struct SearchService;

impl SearchService {
    pub fn new() -> Self {
        SearchService
    }

    pub fn search(&self, query: &str, limit: i64) -> Result<Vec<i64>, String> {
        let conn = db::get()?;

        let fts_query = self.build_fts_query(query);
        if fts_query.is_empty() {
            return Ok(vec![]);
        }

        let mut stmt = conn
            .prepare(
                "SELECT rowid FROM emails_fts WHERE emails_fts MATCH ?1 ORDER BY rank LIMIT ?2",
            )
            .map_err(|e| e.to_string())?;

        let ids: Vec<i64> = stmt
            .query_map(rusqlite::params![fts_query, limit], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        Ok(ids)
    }

    fn build_fts_query(&self, query: &str) -> String {
        let terms: Vec<&str> = query.split_whitespace().collect();
        if terms.is_empty() {
            return "".to_string();
        }

        let escaped: Vec<String> = terms
            .iter()
            .map(|term| {
                let cleaned: String = term
                    .chars()
                    .filter(|c| c.is_alphanumeric() || *c == '*' || *c == '"')
                    .collect();
                if cleaned.is_empty() {
                    String::new()
                } else if cleaned.ends_with('*') {
                    format!("{} ", cleaned)
                } else {
                    format!("{}* ", cleaned)
                }
            })
            .filter(|s| !s.is_empty())
            .collect();

        if escaped.is_empty() {
            return "".to_string();
        }

        if escaped.len() == 1 {
            escaped[0].clone()
        } else {
            format!("\"{}\"", escaped.join(" "))
        }
    }
}

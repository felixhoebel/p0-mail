use keyring::Entry;
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

const SERVICE_NAME: &str = "p0mail";

static SECRET_CACHE: Lazy<Mutex<HashMap<String, String>>> = Lazy::new(|| Mutex::new(HashMap::new()));

fn cache_insert(key: &str, value: &str) {
    if let Ok(mut cache) = SECRET_CACHE.lock() {
        cache.insert(key.to_string(), value.to_string());
    }
}

fn cache_remove(key: &str) {
    if let Ok(mut cache) = SECRET_CACHE.lock() {
        cache.remove(key);
    }
}

pub fn store_secret(key: &str, value: &str) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, key).map_err(|e| e.to_string())?;
    entry.set_password(value).map_err(|e| e.to_string())?;
    cache_insert(key, value);
    Ok(())
}

fn map_keyring_error(key: &str, err: String) -> String {
    if err.contains("No matching entry") {
        format!(
            "No credentials stored for \"{key}\". Remove the account in Settings and connect Google again."
        )
    } else {
        err
    }
}

pub fn get_secret(key: &str) -> Result<String, String> {
    if let Ok(cache) = SECRET_CACHE.lock() {
        if let Some(value) = cache.get(key) {
            return Ok(value.clone());
        }
    }

    let entry = Entry::new(SERVICE_NAME, key).map_err(|e| e.to_string())?;
    let value = entry
        .get_password()
        .map_err(|e| map_keyring_error(key, e.to_string()))?;
    cache_insert(key, &value);
    Ok(value)
}

pub fn has_access_token(account_id: i64) -> bool {
    let key = format!("account_{account_id}_access_token");
    if let Ok(cache) = SECRET_CACHE.lock() {
        if cache.contains_key(&key) {
            return true;
        }
    }
    get_access_token(account_id).is_ok()
}

pub fn delete_secret(key: &str) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, key).map_err(|e| e.to_string())?;
    entry.delete_credential().map_err(|e| e.to_string())?;
    cache_remove(key);
    Ok(())
}

pub fn store_access_token(account_id: i64, token: &str) -> Result<(), String> {
    store_secret(&format!("account_{account_id}_access_token"), token)
}

pub fn get_access_token(account_id: i64) -> Result<String, String> {
    get_secret(&format!("account_{account_id}_access_token"))
}

pub fn store_refresh_token(account_id: i64, token: &str) -> Result<(), String> {
    store_secret(&format!("account_{account_id}_refresh_token"), token)
}

pub fn get_refresh_token(account_id: i64) -> Result<String, String> {
    get_secret(&format!("account_{account_id}_refresh_token"))
}

pub fn store_imap_password(account_id: i64, password: &str) -> Result<(), String> {
    store_secret(&format!("account_{account_id}_imap_password"), password)
}

pub fn get_imap_password(account_id: i64) -> Result<String, String> {
    get_secret(&format!("account_{account_id}_imap_password"))
}

pub fn store_ai_api_key(key: &str) -> Result<(), String> {
    store_secret("ai_api_key", key)
}

pub fn get_ai_api_key() -> Result<String, String> {
    get_secret("ai_api_key")
}

const DB_KEY_NAME: &str = "p0mail_db_key";

pub fn get_db_key() -> Result<String, String> {
    get_secret(DB_KEY_NAME)
}

pub fn store_db_key(key: &str) -> Result<(), String> {
    store_secret(DB_KEY_NAME, key)
}

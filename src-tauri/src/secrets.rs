//! API key storage in the OS keyring. Keys are written and read here only; the webview can set,
//! delete and ask whether a key exists, but never read one back.

use std::collections::HashMap;
use std::sync::Mutex;

pub const SERVICE: &str = "io.github.cevo1466.openiosstudio";

pub trait SecretStore: Send + Sync {
    fn set(&self, account: &str, secret: &str) -> Result<(), String>;
    fn get(&self, account: &str) -> Result<Option<String>, String>;
    fn delete(&self, account: &str) -> Result<(), String>;
}

/// Keyring account for a provider. Only providers that use a key are accepted.
pub fn account_for(provider: &str) -> Result<String, String> {
    match provider {
        "anthropic" | "openai" => Ok(format!("ai-key-{provider}")),
        "ollama" => Err("Ollama runs locally and does not use an API key.".to_owned()),
        other => Err(format!("Unknown provider '{other}'.")),
    }
}

pub fn validate_key(key: &str) -> Result<(), String> {
    if key.trim().is_empty() {
        return Err("The API key is empty.".to_owned());
    }
    if key.len() > 512 {
        return Err("The API key is too long.".to_owned());
    }
    if key.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("The API key must not contain spaces or control characters.".to_owned());
    }
    Ok(())
}

#[derive(Default)]
pub struct KeyringStore;

impl KeyringStore {
    fn entry(account: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVICE, account).map_err(|e| format!("Keyring unavailable: {e}"))
    }
}

impl SecretStore for KeyringStore {
    fn set(&self, account: &str, secret: &str) -> Result<(), String> {
        Self::entry(account)?
            .set_password(secret)
            .map_err(|e| format!("Could not store the key in the OS keyring: {e}"))
    }

    fn get(&self, account: &str) -> Result<Option<String>, String> {
        match Self::entry(account)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("Could not read the OS keyring: {e}")),
        }
    }

    fn delete(&self, account: &str) -> Result<(), String> {
        match Self::entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("Could not remove the key from the OS keyring: {e}")),
        }
    }
}

/// In-memory store for tests.
#[derive(Default)]
pub struct MemoryStore(Mutex<HashMap<String, String>>);

impl SecretStore for MemoryStore {
    fn set(&self, account: &str, secret: &str) -> Result<(), String> {
        self.0
            .lock()
            .map_err(|_| "store poisoned".to_owned())?
            .insert(account.to_owned(), secret.to_owned());
        Ok(())
    }

    fn get(&self, account: &str) -> Result<Option<String>, String> {
        Ok(self
            .0
            .lock()
            .map_err(|_| "store poisoned".to_owned())?
            .get(account)
            .cloned())
    }

    fn delete(&self, account: &str) -> Result<(), String> {
        self.0
            .lock()
            .map_err(|_| "store poisoned".to_owned())?
            .remove(account);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_keyed_providers_have_accounts() {
        assert_eq!(account_for("anthropic").as_deref(), Ok("ai-key-anthropic"));
        assert_eq!(account_for("openai").as_deref(), Ok("ai-key-openai"));
        assert!(account_for("ollama").is_err());
        assert!(account_for("../etc").is_err());
    }

    #[test]
    fn key_validation() {
        assert!(validate_key("sk-ant-abc123").is_ok());
        assert!(validate_key("").is_err());
        assert!(validate_key("   ").is_err());
        assert!(validate_key("has space").is_err());
        assert!(validate_key("line\nbreak").is_err());
        assert!(validate_key(&"k".repeat(513)).is_err());
    }

    #[test]
    fn memory_store_roundtrip() {
        let store = MemoryStore::default();
        assert_eq!(store.get("a").expect("get"), None);
        store.set("a", "secret").expect("set");
        assert_eq!(store.get("a").expect("get").as_deref(), Some("secret"));
        store.delete("a").expect("delete");
        assert_eq!(store.get("a").expect("get"), None);
    }
}

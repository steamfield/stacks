//! The notes resource: its types, validation and the store behind it. Knows
//! nothing about HTTP; `routes::notes` maps it to requests.

use std::collections::BTreeMap;
use std::future::Future;
use std::ops::Bound;
use std::sync::{Mutex, PoisonError};

use serde::{Deserialize, Serialize};

pub const MAX_TITLE: usize = 200;
pub const MAX_BODY: usize = 10_000;
pub const DEFAULT_LIMIT: usize = 20;
pub const MAX_LIMIT: usize = 100;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub body: String,
}

/// What a client sends to create a note. Unknown fields are rejected.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NewNote {
    pub title: String,
    #[serde(default)]
    pub body: String,
}

/// One page of notes in creation order; `next_cursor` is absent on the last page.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub items: Vec<Note>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum NoteError {
    #[error("{0}")]
    Invalid(&'static str),
    #[error("invalid cursor")]
    BadCursor,
    #[error("note not found")]
    NotFound,
}

impl NewNote {
    /// Trim the title and check both lengths in characters.
    pub fn validate(self) -> Result<Self, NoteError> {
        let title = self.title.trim().to_owned();
        if title.is_empty() || title.chars().count() > MAX_TITLE {
            return Err(NoteError::Invalid("title must contain 1 to 200 characters"));
        }
        if self.body.chars().count() > MAX_BODY {
            return Err(NoteError::Invalid(
                "body must contain at most 10000 characters",
            ));
        }
        Ok(Self {
            title,
            body: self.body,
        })
    }
}

/// Where notes live. The in-memory store proves the routes; a database store
/// implements the same methods and the routes don't change.
pub trait NoteStore: Send + Sync + 'static {
    fn create(&self, input: NewNote) -> impl Future<Output = Result<Note, NoteError>> + Send;
    fn get(&self, id: &str) -> impl Future<Output = Result<Note, NoteError>> + Send;
    fn list(
        &self,
        limit: usize,
        cursor: Option<&str>,
    ) -> impl Future<Output = Result<Page, NoteError>> + Send;
}

/// Notes held in memory, erased on restart. Ids are sequential and opaque.
#[derive(Debug, Default)]
pub struct MemoryStore {
    state: Mutex<State>,
}

#[derive(Debug, Default)]
struct State {
    next_id: u64,
    notes: BTreeMap<u64, Note>,
}

fn encode(id: u64) -> String {
    format!("{id:016x}")
}

fn decode(id: &str) -> Option<u64> {
    (id.len() == 16)
        .then(|| u64::from_str_radix(id, 16).ok())
        .flatten()
}

impl MemoryStore {
    fn with_state<T>(&self, f: impl FnOnce(&mut State) -> T) -> T {
        // A panic while holding the lock can't leave State half-written, so a
        // poisoned lock is still safe to use.
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        f(&mut state)
    }

    fn create_now(&self, input: NewNote) -> Result<Note, NoteError> {
        let input = input.validate()?;
        Ok(self.with_state(|state| {
            state.next_id += 1;
            let note = Note {
                id: encode(state.next_id),
                title: input.title,
                body: input.body,
            };
            state.notes.insert(state.next_id, note.clone());
            note
        }))
    }

    fn get_now(&self, id: &str) -> Result<Note, NoteError> {
        let key = decode(id).ok_or(NoteError::NotFound)?;
        self.with_state(|state| state.notes.get(&key).cloned())
            .ok_or(NoteError::NotFound)
    }

    fn list_now(&self, limit: usize, cursor: Option<&str>) -> Result<Page, NoteError> {
        if !(1..=MAX_LIMIT).contains(&limit) {
            return Err(NoteError::Invalid("limit must be between 1 and 100"));
        }
        let after = match cursor {
            None => Bound::Unbounded,
            Some(cursor) => Bound::Excluded(decode(cursor).ok_or(NoteError::BadCursor)?),
        };
        Ok(self.with_state(|state| {
            let mut rest = state.notes.range((after, Bound::Unbounded));
            let items: Vec<Note> = rest.by_ref().take(limit).map(|(_, n)| n.clone()).collect();
            let next_cursor = match (rest.next(), items.last()) {
                (Some(_), Some(last)) => Some(last.id.clone()),
                _ => None,
            };
            Page { items, next_cursor }
        }))
    }
}

// Memory never waits, so each method is ready at once. A database store
// writes `async fn` bodies instead.
impl NoteStore for MemoryStore {
    fn create(&self, input: NewNote) -> impl Future<Output = Result<Note, NoteError>> + Send {
        std::future::ready(self.create_now(input))
    }

    fn get(&self, id: &str) -> impl Future<Output = Result<Note, NoteError>> + Send {
        std::future::ready(self.get_now(id))
    }

    fn list(
        &self,
        limit: usize,
        cursor: Option<&str>,
    ) -> impl Future<Output = Result<Page, NoteError>> + Send {
        std::future::ready(self.list_now(limit, cursor))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn new(title: &str) -> NewNote {
        NewNote {
            title: title.to_owned(),
            body: String::new(),
        }
    }

    #[tokio::test]
    async fn create_trims_and_get_returns_the_same_note() {
        let store = MemoryStore::default();
        let note = store.create(new("  first  ")).await.unwrap();
        assert_eq!(note.title, "first");
        assert_eq!(store.get(&note.id).await.unwrap(), note);
        assert_eq!(store.get("missing").await, Err(NoteError::NotFound));
    }

    #[tokio::test]
    async fn titles_and_bodies_are_checked_in_characters() {
        let store = MemoryStore::default();
        assert!(store.create(new(" ")).await.is_err());
        assert!(store.create(new(&"é".repeat(MAX_TITLE))).await.is_ok());
        assert!(store.create(new(&"é".repeat(MAX_TITLE + 1))).await.is_err());
        let long_body = NewNote {
            title: "t".to_owned(),
            body: "b".repeat(MAX_BODY + 1),
        };
        assert!(store.create(long_body).await.is_err());
    }

    #[tokio::test]
    async fn pages_follow_creation_order_until_the_last() {
        let store = MemoryStore::default();
        for title in ["a", "b", "c"] {
            store.create(new(title)).await.unwrap();
        }
        let first = store.list(2, None).await.unwrap();
        let titles: Vec<_> = first.items.iter().map(|n| n.title.as_str()).collect();
        assert_eq!(titles, ["a", "b"]);
        let cursor = first.next_cursor.unwrap();
        let last = store.list(2, Some(&cursor)).await.unwrap();
        assert_eq!(last.items.len(), 1);
        assert_eq!(last.next_cursor, None);
        assert_eq!(
            store.list(2, Some("bogus")).await,
            Err(NoteError::BadCursor)
        );
        assert!(store.list(0, None).await.is_err());
        assert!(store.list(MAX_LIMIT + 1, None).await.is_err());
    }
}

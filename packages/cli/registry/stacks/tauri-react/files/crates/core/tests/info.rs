use core_app::{InfoError, app_info};

#[test]
fn caller_gets_typed_errors_and_serializable_info() {
    assert_eq!(app_info("", "dev"), Err(InfoError::EmptyName));
    let value = serde_json::to_value(app_info("Desktop", "dev").unwrap()).unwrap();
    assert_eq!(value["name"], "Desktop");
    assert_eq!(value["version"], "dev");
    assert!(value["os"].is_string());
}

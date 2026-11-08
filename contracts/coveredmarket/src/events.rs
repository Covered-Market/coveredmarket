//! NEP-297 events, standard `coveredmarket`, version `1.0.0`.

use near_sdk::env;

pub fn emit(event: &str, serial: u64, data: serde_json::Value) {
    let mut d = data;
    if let serde_json::Value::Object(ref mut m) = d {
        m.insert("serial".into(), serde_json::Value::from(serial));
    }
    let v = serde_json::json!({
        "standard": "coveredmarket",
        "version": "1.0.0",
        "event": event,
        "data": [d],
    });
    env::log_str(&format!("EVENT_JSON:{}", v));
}

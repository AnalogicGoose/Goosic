fn main() {
    inject_lastfm_credentials();
    tauri_build::build()
}

/// Make the Last.fm API key + shared secret available to `option_env!` in
/// src/lastfm.rs WITHOUT committing them to source. Precedence: existing env
/// vars (set as GitHub Actions secrets for release builds), then a gitignored
/// `lastfm_config.json` next to this file (for local dev). If neither provides a
/// value the env var is left unset and the feature simply stays unconfigured.
fn inject_lastfm_credentials() {
    println!("cargo:rerun-if-env-changed=YTUBIC_LASTFM_API_KEY");
    println!("cargo:rerun-if-env-changed=YTUBIC_LASTFM_API_SECRET");
    println!("cargo:rerun-if-changed=lastfm_config.json");

    let mut key = std::env::var("YTUBIC_LASTFM_API_KEY").unwrap_or_default();
    let mut secret = std::env::var("YTUBIC_LASTFM_API_SECRET").unwrap_or_default();

    if key.is_empty() || secret.is_empty() {
        if let Ok(raw) = std::fs::read_to_string("lastfm_config.json") {
            if key.is_empty() {
                if let Some(v) = json_string_field(&raw, "api_key") {
                    key = v;
                }
            }
            if secret.is_empty() {
                if let Some(v) = json_string_field(&raw, "api_secret") {
                    secret = v;
                }
            }
        }
    }

    if !key.is_empty() {
        println!("cargo:rustc-env=YTUBIC_LASTFM_API_KEY={key}");
    }
    if !secret.is_empty() {
        println!("cargo:rustc-env=YTUBIC_LASTFM_API_SECRET={secret}");
    }
}

/// Pull a top-level string field out of a flat JSON object. Deliberately tiny
/// (the config is two string fields) to avoid a serde_json build-dependency.
fn json_string_field(json: &str, field: &str) -> Option<String> {
    let needle = format!("\"{field}\"");
    let start = json.find(&needle)? + needle.len();
    let after_colon = json[start..].find(':')? + start + 1;
    let rest = &json[after_colon..];
    let open = rest.find('"')? + 1;
    let close = rest[open..].find('"')? + open;
    Some(rest[open..close].to_string())
}

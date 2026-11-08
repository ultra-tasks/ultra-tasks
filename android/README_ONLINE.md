# Online-Only Mode (Compatibility Mode) Configuration

**Online-Only Mode (Compatibility Mode)** allows the Ultra Tasks Android app to load the web app from the upstream production server, a local development server, or a self-hosted server. This mode requires an internet connection and is compatible with various server setups.

**Note**: While Online-Only Mode offers connectivity to production, local development, or self-hosted servers, it is highly recommended to use the latest **Connectivity-Free Mode** for a more stable and reliable experience. Connectivity-Free Mode allows you to use the app without an internet connection, ensuring uninterrupted productivity, enhanced privacy, and reduced latency.

For more information, refer to the **[Connectivity-Free Mode Documentation (Recommended)](./README_OFFLINE.md)**.

If you require online features or need to connect to specific servers, proceed with the Online-Only Mode configuration below.

## Setting Launch Mode to Online

To enable Online-Only Mode, set the `LAUNCH_MODE` to `1` or `0` in `android/app/app_config.properties`.

- **1**: Force Online-Only Mode (Compatibility Mode)
- **0**: Default behavior (read from SharedPreferences)

**Recommendation**: Set `LAUNCH_MODE` to `0` for default behavior. The app will use the default behavior, which may attempt to read from SharedPreferences and connect to online services if available.

### Configuration Options

1. **Launch Mode (`LAUNCH_MODE`)**

   ```properties
   LAUNCH_MODE=1
   ```

   - **0**: Default behavior (read from SharedPreferences)
   - **1**: Force Online-Only Mode (compatible mode)
   - **2**: Force Connectivity-Free Mode (for offline configuration)

2. **Use Production URL**
   - **Condition**: Applicable when `LAUNCH_MODE` is set to `1`, or set to `0` and the user has upgraded from a previous version.
   - **Default**: `https://app.super-productivity.com` (the upstream Super Productivity web app; Ultra Tasks does not host a web app)
   - **Configuration**: Ensure `ONLINE_SERVICE_IS_LOCAL` is set to `false`.

   ```properties
   ONLINE_SERVICE_IS_LOCAL=false
   ```

3. **Use Local Development Server**
   - **Condition**: Applicable when `LAUNCH_MODE` is set to `1`, or set to `0` and the user has upgraded from a previous version.
   - **Configuration**: Set `ONLINE_SERVICE_IS_LOCAL` to `true` and start the local server.

   ```properties
   ONLINE_SERVICE_IS_LOCAL=true
   ```

   - **Start Local Server**

     ```bash
     ng serve --disable-host-check --host 0.0.0.0 --port 4200 --live-reload --watch
     ```

   - **Access URL**: `http://10.0.2.2:4200` (accessible from the Android Studio emulator and emulator's Chrome browser).

4. **Use a Self-Hosted Server**
   - **Condition**: Applicable when `LAUNCH_MODE` is set to `1`, or set to `0` and the user has upgraded from a previous version.
   - **Configuration**: Set `ONLINE_SERVICE_IS_LOCAL` to `false` and update `ONLINE_SERVICE_HOST` and `ONLINE_SERVICE_PROTOCOL`.

   ```properties
   ONLINE_SERVICE_IS_LOCAL=false
   ONLINE_SERVICE_HOST=your.server.address
   ONLINE_SERVICE_PROTOCOL=https
   ```

## How to Modify the URL

You can edit the URL that the web view loads by modifying `android/app/app_config.properties`. This allows you to easily switch between a production server, a local development server, or a self-hosted server.

### Relevant Settings

- **`LAUNCH_MODE`**:
  - `0`: Default behavior (read from SharedPreferences)
  - `1`: Force Online-Only Mode
  - `2`: Force Connectivity-Free Mode

- **When `LAUNCH_MODE` is `1` or `0` (with upgrade)**:
  - **`ONLINE_SERVICE_IS_LOCAL`**:
    - `true`: Load from local development server (`http://10.0.2.2:4200`).
    - `false`: Load from production or self-hosted server.
  - **`ONLINE_SERVICE_HOST`**:
    - Defines the server's address.
  - **`ONLINE_SERVICE_PROTOCOL`**:
    - `http` or `https`.

## Navigation and native bridge boundary

The online compatibility WebView exposes the `SUPAndroid` native bridge. Its
navigation client keeps HTTP(S) links inside the WebView only when their parsed
scheme, host and effective port match `ONLINE_SERVICE_PROTOCOL` and
`ONLINE_SERVICE_HOST`. Default ports are equivalent (`https://host` and
`https://host:443`, or `http://host` and `http://host:80`); a different port is a
different origin. Configured local development hosts such as
`http://10.0.2.2:4200` keep working. The configured
production host is unchanged.

Other valid HTTP(S) links open externally; if no browser is available, navigation
remains blocked. Malformed and non-HTTP(S) URLs received by the navigation client
are blocked. This adapts [upstream security fix #11582](https://github.com/super-productivity/super-productivity/pull/11582)
and also checks ports and scheme classification.

This is **not complete bridge origin isolation**. [Android's navigation client](https://developer.android.com/reference/android/webkit/WebViewClient) does not call
`shouldOverrideUrlLoading` for POST requests or application-initiated `loadUrl`
calls, and not every frame or scheme passes through that callback. The
[`addJavascriptInterface` bridge is exposed to all frames](<https://developer.android.com/reference/android/webkit/WebView#addJavascriptInterface(java.lang.Object,%20java.lang.String)>),
with no reliable caller-origin identity. A trusted page embedding untrusted
frames, or a compromised configured host, remains a risk. The separate
`sp_cors_skip` resource proxy is unchanged; it is not an authorization gate.

`nativeAccountCall` uses this same bridge without per-origin checks. Session
clearing is unscoped; token-returning `current`, `refresh` and `detach` operations
require matching server/account IDs. This does not establish unconditional token
extraction. Origin-aware bridge replacement is separate work.

Fresh installs normally select connectivity-free mode; existing installations can
retain online mode. The vulnerable substring handler is present in the
`ultra-tasks-v0.2.0` source tag, but installed-user exposure has not been measured.

## Important Notes

- **Local Modifications**: The `app_config.properties` file is intended for local modifications only. **DO NOT COMMIT** this file unless you are absolutely sure of the changes.
- **Switching Servers**: By configuring these properties, you can seamlessly switch between default, online, and offline launch behaviors without making direct changes to your Kotlin source files, improving your development workflow and offering flexibility in deployment.

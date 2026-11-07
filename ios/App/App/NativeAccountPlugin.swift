import Foundation
import Security
import Capacitor

/// Device-only Keychain session storage. This queue is the single refresh owner.
@objc(NativeAccountPlugin)
public class NativeAccountPlugin: CAPPlugin, CAPBridgedPlugin, URLSessionTaskDelegate {
    public let identifier = "NativeAccountPlugin"
    public let jsName = "NativeAccount"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "command", returnType: CAPPluginReturnPromise)]
    private let queue = DispatchQueue(label: "app.ultratasks.native-account")
    private let service = "app.ultratasks.native-account-v2"
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 20
        config.timeoutIntervalForResource = 25
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.urlCache = nil
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()
    private func failure(_ status: OSStatus = 1) -> NSError { NSError(domain: service, code: Int(status), userInfo: [NSLocalizedDescriptionKey: "Native account storage or session unavailable. Sign in again."]) }
    private func query() -> [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "session"] }
    private func read() throws -> [String: Any] {
        var request = query()
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &result)
        guard status == errSecSuccess else { throw failure(status) }
        guard let bytes = result as? Data,
              let value = try JSONSerialization.jsonObject(with: bytes) as? [String: Any] else { throw failure() }
        return value
    }
    private func write(_ profile: [String: Any]) throws {
        let bytes = try JSONSerialization.data(withJSONObject: profile)
        let status = SecItemUpdate(query() as CFDictionary, [kSecValueData as String: bytes] as CFDictionary)
        if status == errSecSuccess { return }
        guard status == errSecItemNotFound else { throw failure(status) }
        var item = query()
        item[kSecValueData as String] = bytes
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let added = SecItemAdd(item as CFDictionary, nil)
        guard added == errSecSuccess else { throw failure(added) }
    }
    private func clear() throws {
        let status = SecItemDelete(query() as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw failure(status) }
    }
    public func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                           newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
    private func tokens(_ input: [String: Any]) throws -> JSObject {
        guard let access = input["accessToken"] as? String, let refresh = input["refreshToken"] as? String,
              let expires = input["expiresIn"] as? NSNumber, !access.isEmpty, !refresh.isEmpty else { throw failure() }
        return ["accessToken": access, "refreshToken": refresh, "expiresIn": expires]
    }
    private func refreshed(_ profile: [String: Any]) throws -> [String: Any] {
        guard let base = profile["baseUrl"] as? String, let url = URL(string: base + "/api/v2/accounts/sessions/refresh"),
              let old = profile["tokens"] as? [String: Any], let refresh = old["refreshToken"] as? String else { throw failure() }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["refreshToken": refresh])
        let done = DispatchSemaphore(value: 0)
        var responseData: Data?
        var responseStatus: Int?
        let task = session.dataTask(with: request) { data, response, _ in
            responseData = data
            responseStatus = (response as? HTTPURLResponse)?.statusCode
            done.signal()
        }
        task.resume()
        guard done.wait(timeout: .now() + 30) == .success else { task.cancel(); throw failure() }
        if responseStatus == 401 || responseStatus == 403 { try clear(); throw failure() }
        guard responseStatus == 200, let bytes = responseData,
              let value = try JSONSerialization.jsonObject(with: bytes) as? [String: Any] else { throw failure() }
        let nextTokens = try tokens(value)
        var next = profile
        next["tokens"] = nextTokens
        next["expiresAt"] = Date().timeIntervalSince1970 * 1000 + (nextTokens["expiresIn"] as! NSNumber).doubleValue * 1000
        do { try write(next) } catch { try? clear(); throw error }
        return next
    }
    @objc func command(_ call: CAPPluginCall) {
        guard let method = call.getString("method"), let input = call.getObject("input") else { call.reject("Invalid native account command"); return }
        queue.async {
            do {
                if method == "clear" { try self.clear(); call.resolve(["cleared": true]); return }
                if method == "configure" || method == "bootstrap" {
                    guard let server = input["serverId"] as? String, let account = input["accountId"] as? String,
                          let base = input["baseUrl"] as? String, let url = URL(string: base),
                          url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
                          url.scheme == "https" || url.scheme == "http" && ["localhost", "127.0.0.1", "[::1]"].contains(url.host ?? "") else { throw self.failure() }
                    if method == "bootstrap", let prior = try? self.read(), prior["serverId"] as? String == server, prior["accountId"] as? String == account {
                        call.resolve(["configured": true]); return
                    }
                    let rawTokens: [String: Any]
                    if method == "configure", let supplied = input["tokens"] as? [String: Any] { rawTokens = supplied }
                    else if let refresh = input["refreshToken"] as? String { rawTokens = ["accessToken": "pending", "refreshToken": refresh, "expiresIn": 0] }
                    else { throw self.failure() }
                    try self.write(["serverId": server, "accountId": account, "baseUrl": base,
                                    "tokens": try self.tokens(rawTokens), "expiresAt": method == "configure" ? Date().timeIntervalSince1970 * 1000 + 600000 : 0])
                    call.resolve(["configured": true]); return
                }
                var profile = try self.read()
                guard profile["serverId"] as? String == input["serverId"] as? String,
                      profile["accountId"] as? String == input["accountId"] as? String else { throw self.failure() }
                if method == "detach" {
                    guard let stored = profile["tokens"] as? [String: Any] else { throw self.failure() }
                    // JSONSerialization returns Foundation objects. Convert the
                    // validated fields to Swift JSValue types before bridging.
                    var latest = try self.tokens(stored)
                    let expiry = (profile["expiresAt"] as? NSNumber)?.doubleValue ?? 0
                    latest["expiresIn"] = max(0, Int((expiry - Date().timeIntervalSince1970 * 1000) / 1000))
                    try self.clear(); call.resolve(latest); return
                }
                if method == "scopes" { call.resolve(["updated": true]); return }
                guard method == "current" || method == "refresh" else { throw self.failure() }
                let expires = (profile["expiresAt"] as? NSNumber)?.doubleValue ?? 0
                if method == "refresh" || Date().timeIntervalSince1970 * 1000 >= expires - 60000 { profile = try self.refreshed(profile) }
                guard let stored = profile["tokens"] as? [String: Any] else { throw self.failure() }
                var result = try self.tokens(stored)
                let validUntil = (profile["expiresAt"] as? NSNumber)?.doubleValue ?? 0
                result["expiresIn"] = max(1, Int((validUntil - Date().timeIntervalSince1970 * 1000) / 1000))
                call.resolve(result)
            } catch {
                // Only expose our numeric status, never the stored profile or a
                // Foundation/network error description that might contain data.
                let nativeError = error as NSError
                let code = nativeError.domain == self.service ? String(nativeError.code) : "1"
                call.reject("Native account storage or session unavailable. Sign in again.", code)
            }
        }
    }
}

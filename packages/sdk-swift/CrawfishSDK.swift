import Foundation

// MARK: - Crawfish SDK for iOS

/// Lightweight analytics SDK for Crawfish. Zero dependencies beyond Foundation.
///
/// Usage:
///   Crawfish.shared.configure(apiKey: "ck_xxx", appId: "app_health")
///   Crawfish.shared.identify(userId: "u_123", traits: ["plan": "pro"])
///   Crawfish.shared.track(event: "workout_completed", properties: ["sets": 18])
///
public final class Crawfish {

    public static let shared = Crawfish()

    // MARK: - Configuration

    private var apiKey: String?
    private var appId: String?
    private var endpoint = "https://api.crawfish.dev/v1"
    private var userId: String?
    private var userTraits: [String: Any] = [:]
    private var batchSize = 10
    private var flushIntervalSeconds: TimeInterval = 5.0

    private var queue: [[String: Any]] = []
    private let lock = NSLock()
    private var flushTimer: Timer?

    private init() {}

    /// Configure the SDK. Call once at app launch.
    public func configure(apiKey: String, appId: String, endpoint: String? = nil) {
        self.apiKey = apiKey
        self.appId = appId
        if let endpoint = endpoint { self.endpoint = endpoint }

        startFlushTimer()

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(appWillResignActive),
            name: UIApplication.willResignActiveNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(appWillTerminate),
            name: UIApplication.willTerminateNotification,
            object: nil
        )
    }

    // MARK: - Public API

    /// Identify the current user.
    public func identify(userId: String, traits: [String: Any] = [:]) {
        self.userId = userId
        self.userTraits = traits
        enqueue(type: "identify", data: ["userId": userId, "traits": traits])
    }

    /// Track a custom event.
    public func track(event: String, properties: [String: Any] = [:]) {
        enqueue(type: "track", data: ["event": event, "properties": properties])
    }

    /// Submit user feedback.
    public func feedback(text: String? = nil, rating: Int? = nil, screen: String? = nil) {
        var data: [String: Any] = [:]
        if let text = text { data["comment"] = text }
        if let rating = rating { data["rating"] = rating }
        if let screen = screen { data["screen"] = screen }
        enqueue(type: "feedback", data: data)
    }

    /// Get experiment variant for the current user.
    public func experiment(name: String) -> ExperimentHandle {
        return ExperimentHandle(sdk: self, key: name)
    }

    // MARK: - Experiment Handle

    public final class ExperimentHandle {
        private let sdk: Crawfish
        private let key: String

        init(sdk: Crawfish, key: String) {
            self.sdk = sdk
            self.key = key
        }

        /// Fetch the variant assignment. Returns "control" on error.
        public func variant(completion: @escaping (String) -> Void) {
            guard let apiKey = sdk.apiKey, let appId = sdk.appId else {
                completion("control")
                return
            }

            var components = URLComponents(string: "\(sdk.endpoint)/flags")!
            components.queryItems = [URLQueryItem(name: "key", value: key)]
            if let userId = sdk.userId {
                components.queryItems?.append(URLQueryItem(name: "user", value: userId))
            }

            var request = URLRequest(url: components.url!)
            request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
            request.setValue(appId, forHTTPHeaderField: "X-Crawfish-App")

            URLSession.shared.dataTask(with: request) { data, _, error in
                guard error == nil,
                      let data = data,
                      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let value = json["value"] as? String else {
                    completion("control")
                    return
                }
                completion(value)
            }.resume()
        }

        /// Async variant (iOS 13+ with concurrency backport, or iOS 15+).
        @available(iOS 15.0, *)
        public func variant() async -> String {
            await withCheckedContinuation { continuation in
                variant { value in
                    continuation.resume(returning: value)
                }
            }
        }
    }

    // MARK: - Internals

    private func enqueue(type: String, data: [String: Any]) {
        let event: [String: Any] = [
            "type": type,
            "timestamp": ISO8601DateFormatter().string(from: Date()),
            "userId": userId as Any,
            "data": data,
            "metadata": userTraits.isEmpty ? [:] : ["traits": userTraits],
        ]

        lock.lock()
        queue.append(event)
        let shouldFlush = queue.count >= batchSize
        lock.unlock()

        if shouldFlush { flush() }
    }

    /// Flush queued events to the API.
    public func flush() {
        lock.lock()
        guard !queue.isEmpty else { lock.unlock(); return }
        let batch = Array(queue.prefix(batchSize))
        queue.removeFirst(min(batchSize, queue.count))
        lock.unlock()

        guard let apiKey = apiKey, let appId = appId else { return }

        let body: [String: Any] = ["appId": appId, "events": batch]
        guard let jsonData = try? JSONSerialization.data(withJSONObject: body) else { return }

        var request = URLRequest(url: URL(string: "\(endpoint)/events")!)
        request.httpMethod = "POST"
        request.httpBody = jsonData
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(appId, forHTTPHeaderField: "X-Crawfish-App")

        URLSession.shared.dataTask(with: request) { _, _, error in
            if let error = error {
                // Re-enqueue on failure (best-effort, no infinite retry)
                #if DEBUG
                print("[Crawfish] Flush failed: \(error.localizedDescription)")
                #endif
            }
        }.resume()
    }

    private func startFlushTimer() {
        flushTimer?.invalidate()
        flushTimer = Timer.scheduledTimer(withTimeInterval: flushIntervalSeconds, repeats: true) { [weak self] _ in
            self?.flush()
        }
    }

    @objc private func appWillResignActive() { flush() }
    @objc private func appWillTerminate() { flush() }
}

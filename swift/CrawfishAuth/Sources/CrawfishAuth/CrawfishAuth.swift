import Foundation
import FirebaseAuth
import FirebaseFirestore
import GoogleSignIn
import AuthenticationServices

/// Singleton auth manager shared across all Crawfish apps.
/// Authenticates against the shared `crawfish-iam` Firebase project.
@MainActor
public final class CrawfishAuth: ObservableObject {

    public static let shared = CrawfishAuth()

    // MARK: - Published State

    @Published public private(set) var currentUser: CrawfishUser?
    @Published public private(set) var entitlements: Entitlements?
    @Published public private(set) var isAuthenticated = false
    @Published public private(set) var isLoading = true

    // MARK: - Private

    private let auth = Auth.auth()
    private let db = Firestore.firestore()
    private var authListener: AuthStateDidChangeListenerHandle?

    private init() {
        authListener = auth.addStateDidChangeListener { [weak self] _, user in
            Task { @MainActor in
                if let user {
                    await self?.loadUser(uid: user.uid)
                } else {
                    self?.currentUser = nil
                    self?.entitlements = nil
                    self?.isAuthenticated = false
                }
                self?.isLoading = false
            }
        }
    }

    deinit {
        if let listener = authListener {
            auth.removeStateDidChangeListener(listener)
        }
    }

    // MARK: - Sign In

    public func signIn(email: String, password: String) async throws {
        let result = try await auth.signIn(withEmail: email, password: password)
        await loadUser(uid: result.user.uid)
    }

    public func signInWithApple(credential: ASAuthorizationAppleIDCredential) async throws {
        guard let tokenData = credential.identityToken,
              let idToken = String(data: tokenData, encoding: .utf8) else {
            throw CrawfishAuthError.invalidCredential
        }

        let oAuthCredential = OAuthProvider.appleCredential(
            withIDToken: idToken,
            rawNonce: nil,
            fullName: credential.fullName
        )

        let result = try await auth.signIn(with: oAuthCredential)
        await loadUser(uid: result.user.uid)
    }

    public func signInWithGoogle(presenting: Any) async throws {
        // GIDSignIn handles the UI flow; caller passes the presenting view controller
        guard let clientID = auth.app?.options.clientID else {
            throw CrawfishAuthError.configurationError
        }

        let config = GIDConfiguration(clientID: clientID)
        GIDSignIn.sharedInstance.configuration = config

        // In production, pass the actual UIViewController
        // For now, this is a placeholder for the integration pattern
        throw CrawfishAuthError.notImplemented
    }

    public func signOut() throws {
        try auth.signOut()
        currentUser = nil
        entitlements = nil
        isAuthenticated = false
    }

    // MARK: - Registration

    public func register(email: String, password: String, displayName: String? = nil) async throws {
        let result = try await auth.createUser(withEmail: email, password: password)

        if let displayName {
            let changeRequest = result.user.createProfileChangeRequest()
            changeRequest.displayName = displayName
            try await changeRequest.commitChanges()
        }

        await loadUser(uid: result.user.uid)
    }

    // MARK: - Entitlement Checks

    public func hasAccess(app: AppId) -> Bool {
        entitlements?.forApp(app)?.hasAccess ?? false
    }

    public func hasFeature(_ feature: String) -> Bool {
        entitlements?.globalFeatures[feature]?.boolValue ?? false
    }

    public func remainingAIQueries(app: AppId) -> Int {
        guard let appEnt = entitlements?.forApp(app) else { return 0 }
        if appEnt.aiQueriesPerDay == -1 { return Int.max }
        // Actual remaining requires server check; return limit as upper bound
        return appEnt.aiQueriesPerDay
    }

    // MARK: - Token

    public func getIDToken() async throws -> String {
        guard let user = auth.currentUser else {
            throw CrawfishAuthError.notAuthenticated
        }
        return try await user.getIDToken()
    }

    // MARK: - Private

    private func loadUser(uid: String) async {
        do {
            let doc = try await db.collection("users").document(uid).getDocument()
            if let data = doc.data() {
                let jsonData = try JSONSerialization.data(withJSONObject: data)
                let user = try JSONDecoder().decode(CrawfishUser.self, from: jsonData)
                self.currentUser = user
                self.entitlements = user.entitlements
                self.isAuthenticated = true
            }
        } catch {
            print("[CrawfishAuth] Failed to load user: \(error)")
        }
    }
}

// MARK: - Errors

public enum CrawfishAuthError: LocalizedError {
    case invalidCredential
    case configurationError
    case notAuthenticated
    case notImplemented

    public var errorDescription: String? {
        switch self {
        case .invalidCredential: return "Invalid credential"
        case .configurationError: return "Firebase configuration error"
        case .notAuthenticated: return "Not authenticated"
        case .notImplemented: return "Not yet implemented"
        }
    }
}

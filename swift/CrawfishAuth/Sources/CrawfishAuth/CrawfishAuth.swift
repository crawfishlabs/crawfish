import Foundation
import FirebaseAuth
import FirebaseFirestore
import GoogleSignIn
import AuthenticationServices
import CryptoKit

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
    private var currentNonce: String?

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

    // MARK: - Email/Password Sign In

    public func signIn(email: String, password: String) async throws {
        let result = try await auth.signIn(withEmail: email, password: password)
        await loadUser(uid: result.user.uid)
    }

    // MARK: - Registration with Email Verification

    public func register(email: String, password: String, displayName: String? = nil) async throws {
        let result = try await auth.createUser(withEmail: email, password: password)

        if let displayName {
            let changeRequest = result.user.createProfileChangeRequest()
            changeRequest.displayName = displayName
            try await changeRequest.commitChanges()
        }

        // Send verification email
        try await result.user.sendEmailVerification()

        // Create IAM user record via backend
        if let idToken = try? await result.user.getIDToken() {
            await createIAMUser(idToken: idToken, email: email, displayName: displayName)
        }

        await loadUser(uid: result.user.uid)
    }

    // MARK: - Apple Sign In

    /// Prepare an Apple Sign-In request. Call this in your ASAuthorizationController setup.
    public func prepareAppleSignInRequest(_ request: ASAuthorizationAppleIDRequest) {
        let nonce = Self.randomNonceString()
        currentNonce = nonce
        request.requestedScopes = [.email, .fullName]
        request.nonce = Self.sha256(nonce)
    }

    /// Complete Apple Sign-In with the authorization credential.
    public func signInWithApple(credential: ASAuthorizationAppleIDCredential) async throws {
        guard let nonce = currentNonce else {
            throw CrawfishAuthError.invalidCredential
        }

        guard let tokenData = credential.identityToken,
              let idToken = String(data: tokenData, encoding: .utf8) else {
            throw CrawfishAuthError.invalidCredential
        }

        let oAuthCredential = OAuthProvider.appleCredential(
            withIDToken: idToken,
            rawNonce: nonce,
            fullName: credential.fullName
        )

        let result = try await auth.signIn(with: oAuthCredential)

        // Apple only provides name on first sign-in; persist it
        if let fullName = credential.fullName,
           let givenName = fullName.givenName {
            let displayName = [givenName, fullName.familyName].compactMap { $0 }.joined(separator: " ")
            if result.user.displayName == nil || result.user.displayName?.isEmpty == true {
                let changeRequest = result.user.createProfileChangeRequest()
                changeRequest.displayName = displayName
                try? await changeRequest.commitChanges()
            }
        }

        await loadUser(uid: result.user.uid)
    }

    // MARK: - Google Sign In

    /// Sign in with Google. Requires a presenting UIViewController.
    public func signInWithGoogle(presenting viewController: UIViewController) async throws {
        guard let clientID = auth.app?.options.clientID else {
            throw CrawfishAuthError.configurationError
        }

        let config = GIDConfiguration(clientID: clientID)
        GIDSignIn.sharedInstance.configuration = config

        let googleResult = try await GIDSignIn.sharedInstance.signIn(withPresenting: viewController)

        guard let idToken = googleResult.user.idToken?.tokenString else {
            throw CrawfishAuthError.invalidCredential
        }

        let credential = GoogleAuthProvider.credential(
            withIDToken: idToken,
            accessToken: googleResult.user.accessToken.tokenString
        )

        let result = try await auth.signIn(with: credential)
        await loadUser(uid: result.user.uid)
    }

    // MARK: - Sign Out

    public func signOut() throws {
        try auth.signOut()
        GIDSignIn.sharedInstance.signOut()
        currentUser = nil
        entitlements = nil
        isAuthenticated = false
    }

    // MARK: - Password Reset

    public func resetPassword(email: String) async throws {
        try await auth.sendPasswordReset(withEmail: email)
    }

    // MARK: - Provider Linking

    /// Link Google provider to existing account.
    public func linkGoogleProvider(presenting viewController: UIViewController) async throws {
        guard let user = auth.currentUser else { throw CrawfishAuthError.notAuthenticated }
        guard let clientID = auth.app?.options.clientID else { throw CrawfishAuthError.configurationError }

        let config = GIDConfiguration(clientID: clientID)
        GIDSignIn.sharedInstance.configuration = config

        let googleResult = try await GIDSignIn.sharedInstance.signIn(withPresenting: viewController)
        guard let idToken = googleResult.user.idToken?.tokenString else { throw CrawfishAuthError.invalidCredential }

        let credential = GoogleAuthProvider.credential(
            withIDToken: idToken,
            accessToken: googleResult.user.accessToken.tokenString
        )

        try await user.link(with: credential)
        await loadUser(uid: user.uid) // Refresh
    }

    /// Link Apple provider to existing account.
    public func linkAppleProvider(credential: ASAuthorizationAppleIDCredential) async throws {
        guard let user = auth.currentUser else { throw CrawfishAuthError.notAuthenticated }
        guard let nonce = currentNonce else { throw CrawfishAuthError.invalidCredential }
        guard let tokenData = credential.identityToken,
              let idToken = String(data: tokenData, encoding: .utf8) else {
            throw CrawfishAuthError.invalidCredential
        }

        let oAuthCredential = OAuthProvider.appleCredential(
            withIDToken: idToken,
            rawNonce: nonce,
            fullName: credential.fullName
        )

        try await user.link(with: oAuthCredential)
        await loadUser(uid: user.uid)
    }

    /// Link email/password to existing social account.
    public func linkEmailProvider(email: String, password: String) async throws {
        guard let user = auth.currentUser else { throw CrawfishAuthError.notAuthenticated }
        let credential = EmailAuthProvider.credential(withEmail: email, password: password)
        try await user.link(with: credential)
        await loadUser(uid: user.uid)
    }

    /// Get list of linked providers for current user.
    public var linkedProviders: [String] {
        auth.currentUser?.providerData.map(\.providerID) ?? []
    }

    // MARK: - Email Verification

    public var isEmailVerified: Bool {
        auth.currentUser?.isEmailVerified ?? false
    }

    public func resendVerificationEmail() async throws {
        guard let user = auth.currentUser else { throw CrawfishAuthError.notAuthenticated }
        try await user.sendEmailVerification()
    }

    public func reloadUser() async throws {
        try await auth.currentUser?.reload()
        if let uid = auth.currentUser?.uid {
            await loadUser(uid: uid)
        }
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
        return appEnt.aiQueriesPerDay
    }

    // MARK: - Token

    public func getIDToken() async throws -> String {
        guard let user = auth.currentUser else {
            throw CrawfishAuthError.notAuthenticated
        }
        return try await user.getIDToken()
    }

    // MARK: - Private Helpers

    private func loadUser(uid: String) async {
        do {
            let doc = try await db.collection("users").document(uid).getDocument()
            if let data = doc.data() {
                let jsonData = try JSONSerialization.data(withJSONObject: data)
                let decoder = JSONDecoder()
                decoder.dateDecodingStrategy = .secondsSince1970
                let user = try decoder.decode(CrawfishUser.self, from: jsonData)
                self.currentUser = user
                self.entitlements = user.entitlements
                self.isAuthenticated = true
            }
        } catch {
            print("[CrawfishAuth] Failed to load user: \(error)")
            // Still mark as authenticated — Firebase user exists even if IAM record doesn't yet
            self.isAuthenticated = true
        }
    }

    private func createIAMUser(idToken: String, email: String, displayName: String?) async {
        guard let url = URL(string: "https://api.crawfishlabs.ai/auth/register") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "email": email,
            "displayName": displayName ?? "",
        ])

        _ = try? await URLSession.shared.data(for: request)
    }

    // MARK: - Crypto Helpers (for Apple Sign-In nonce)

    private static func randomNonceString(length: Int = 32) -> String {
        precondition(length > 0)
        var randomBytes = [UInt8](repeating: 0, count: length)
        let errorCode = SecRandomCopyBytes(kSecRandomDefault, randomBytes.count, &randomBytes)
        if errorCode != errSecSuccess {
            fatalError("Unable to generate nonce. SecRandomCopyBytes failed with OSStatus \(errorCode)")
        }
        let charset: [Character] = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._")
        return String(randomBytes.map { charset[Int($0) % charset.count] })
    }

    private static func sha256(_ input: String) -> String {
        let inputData = Data(input.utf8)
        let hashedData = SHA256.hash(data: inputData)
        return hashedData.compactMap { String(format: "%02x", $0) }.joined()
    }
}

// MARK: - Errors

public enum CrawfishAuthError: LocalizedError {
    case invalidCredential
    case configurationError
    case notAuthenticated
    case notImplemented
    case providerAlreadyLinked

    public var errorDescription: String? {
        switch self {
        case .invalidCredential: return "Invalid credential"
        case .configurationError: return "Firebase configuration error"
        case .notAuthenticated: return "Not authenticated"
        case .notImplemented: return "Not yet implemented"
        case .providerAlreadyLinked: return "This provider is already linked to your account"
        }
    }
}

// MARK: - UIViewController helper for SwiftUI

#if canImport(UIKit)
import UIKit

extension CrawfishAuth {
    /// Convenience: get the top-most view controller for presenting Google Sign-In.
    public static var topViewController: UIViewController? {
        guard let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let window = scene.windows.first(where: { $0.isKeyWindow }) else {
            return nil
        }

        var vc = window.rootViewController
        while let presented = vc?.presentedViewController {
            vc = presented
        }
        return vc
    }
}
#endif

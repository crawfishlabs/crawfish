import SwiftUI
import CrawfishAuth
import AuthenticationServices

public struct LoginView: View {
    @StateObject private var auth = CrawfishAuth.shared
    @State private var email = ""
    @State private var password = ""
    @State private var error: String?
    @State private var isLoading = false
    @State private var showRegister = false

    public init() {}

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    // Logo
                    Image(systemName: "person.circle.fill")
                        .font(.system(size: 80))
                        .foregroundStyle(.red)
                        .padding(.top, 40)

                    Text("Welcome to Crawfish")
                        .font(.title.bold())

                    Text("Sign in to access your apps")
                        .foregroundStyle(.secondary)

                    // Email/Password
                    VStack(spacing: 16) {
                        TextField("Email", text: $email)
                            .textContentType(.emailAddress)
                            .keyboardType(.emailAddress)
                            .autocapitalization(.none)
                            .textFieldStyle(.roundedBorder)

                        SecureField("Password", text: $password)
                            .textContentType(.password)
                            .textFieldStyle(.roundedBorder)

                        if let error {
                            Text(error)
                                .foregroundStyle(.red)
                                .font(.caption)
                        }

                        Button(action: signInWithEmail) {
                            if isLoading {
                                ProgressView()
                                    .frame(maxWidth: .infinity)
                            } else {
                                Text("Sign In")
                                    .frame(maxWidth: .infinity)
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.red)
                        .disabled(email.isEmpty || password.isEmpty || isLoading)
                    }
                    .padding(.horizontal)

                    // Divider
                    HStack {
                        Rectangle().frame(height: 1).foregroundStyle(.secondary.opacity(0.3))
                        Text("or").foregroundStyle(.secondary)
                        Rectangle().frame(height: 1).foregroundStyle(.secondary.opacity(0.3))
                    }
                    .padding(.horizontal)

                    // Social sign-in
                    VStack(spacing: 12) {
                        SignInWithAppleButton(.signIn) { request in
                            request.requestedScopes = [.email, .fullName]
                        } onCompletion: { result in
                            handleAppleSignIn(result)
                        }
                        .signInWithAppleButtonStyle(.black)
                        .frame(height: 50)

                        Button(action: signInWithGoogle) {
                            HStack {
                                Image(systemName: "globe")
                                Text("Sign in with Google")
                            }
                            .frame(maxWidth: .infinity)
                            .frame(height: 50)
                        }
                        .buttonStyle(.bordered)
                    }
                    .padding(.horizontal)

                    // Register link
                    Button("Don't have an account? Sign up") {
                        showRegister = true
                    }
                    .font(.footnote)
                    .padding(.bottom, 40)
                }
            }
            .navigationDestination(isPresented: $showRegister) {
                RegisterView()
            }
        }
    }

    private func signInWithEmail() {
        isLoading = true
        error = nil
        Task {
            do {
                try await CrawfishAuth.shared.signIn(email: email, password: password)
            } catch {
                self.error = error.localizedDescription
            }
            isLoading = false
        }
    }

    private func handleAppleSignIn(_ result: Result<ASAuthorization, Error>) {
        switch result {
        case .success(let auth):
            if let credential = auth.credential as? ASAuthorizationAppleIDCredential {
                Task {
                    do {
                        try await CrawfishAuth.shared.signInWithApple(credential: credential)
                    } catch {
                        self.error = error.localizedDescription
                    }
                }
            }
        case .failure(let err):
            error = err.localizedDescription
        }
    }

    private func signInWithGoogle() {
        // TODO: Implement Google Sign-In flow
    }
}

import SwiftUI
import CrawfishAuth

public struct RegisterView: View {
    @State private var email = ""
    @State private var password = ""
    @State private var confirmPassword = ""
    @State private var displayName = ""
    @State private var error: String?
    @State private var isLoading = false

    public init() {}

    public var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                Text("Create Account")
                    .font(.title.bold())
                    .padding(.top, 20)

                VStack(spacing: 16) {
                    TextField("Display Name", text: $displayName)
                        .textContentType(.name)
                        .textFieldStyle(.roundedBorder)

                    TextField("Email", text: $email)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .autocapitalization(.none)
                        .textFieldStyle(.roundedBorder)

                    SecureField("Password", text: $password)
                        .textContentType(.newPassword)
                        .textFieldStyle(.roundedBorder)

                    SecureField("Confirm Password", text: $confirmPassword)
                        .textContentType(.newPassword)
                        .textFieldStyle(.roundedBorder)

                    if let error {
                        Text(error)
                            .foregroundStyle(.red)
                            .font(.caption)
                    }

                    Button(action: register) {
                        if isLoading {
                            ProgressView().frame(maxWidth: .infinity)
                        } else {
                            Text("Create Account").frame(maxWidth: .infinity)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.red)
                    .disabled(!isValid || isLoading)
                }
                .padding(.horizontal)

                Text("By creating an account, you agree to our Terms of Service and Privacy Policy.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }
        }
        .navigationTitle("Sign Up")
    }

    private var isValid: Bool {
        !email.isEmpty && !password.isEmpty && password == confirmPassword && password.count >= 8
    }

    private func register() {
        isLoading = true
        error = nil
        Task {
            do {
                try await CrawfishAuth.shared.register(
                    email: email,
                    password: password,
                    displayName: displayName.isEmpty ? nil : displayName
                )
            } catch {
                self.error = error.localizedDescription
            }
            isLoading = false
        }
    }
}

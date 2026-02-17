import SwiftUI
import CrawfishAuth

public struct ProfileView: View {
    @StateObject private var auth = CrawfishAuth.shared
    @State private var showPlanSelection = false
    @State private var showDeleteConfirmation = false

    public init() {}

    public var body: some View {
        List {
            // Profile section
            Section {
                HStack(spacing: 16) {
                    Image(systemName: "person.circle.fill")
                        .font(.system(size: 50))
                        .foregroundStyle(.red)

                    VStack(alignment: .leading) {
                        Text(auth.currentUser?.displayName ?? "User")
                            .font(.headline)
                        Text(auth.currentUser?.email ?? "")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 4)
            }

            // Plan section
            Section("Plan") {
                HStack {
                    Text("Current Plan")
                    Spacer()
                    Text(auth.currentUser?.plan.name ?? "Free")
                        .foregroundStyle(.secondary)
                }

                HStack {
                    Text("Status")
                    Spacer()
                    Text(auth.currentUser?.billingStatus.capitalized ?? "Free")
                        .foregroundStyle(statusColor)
                }

                Button("Change Plan") { showPlanSelection = true }
                Button("Manage Subscription") {
                    // Open Stripe portal
                }
            }

            // App Access
            Section("App Access") {
                ForEach(AppId.allCases, id: \.self) { app in
                    HStack {
                        Text(app.rawValue.capitalized)
                        Spacer()
                        if auth.hasAccess(app: app) {
                            let tier = auth.entitlements?.forApp(app)?.tier ?? "free"
                            Text(tier == "pro" ? "Pro ✓" : "Free")
                                .foregroundStyle(tier == "pro" ? .green : .secondary)
                        } else {
                            Text("Locked")
                                .foregroundStyle(.red)
                        }
                    }
                }
            }

            // Account
            Section("Account") {
                Button("Export My Data") {
                    // Trigger GDPR export
                }

                Button("Sign Out") {
                    try? auth.signOut()
                }
                .foregroundStyle(.orange)

                Button("Delete Account", role: .destructive) {
                    showDeleteConfirmation = true
                }
            }
        }
        .navigationTitle("Profile")
        .sheet(isPresented: $showPlanSelection) {
            NavigationStack { PlanSelectionView() }
        }
        .alert("Delete Account?", isPresented: $showDeleteConfirmation) {
            Button("Delete", role: .destructive) {
                // Trigger account deletion via IAM API
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This will permanently delete your account and all data across all Crawfish apps. This cannot be undone.")
        }
    }

    private var statusColor: Color {
        switch auth.currentUser?.billingStatus {
        case "active": return .green
        case "past_due": return .orange
        case "cancelled": return .red
        default: return .secondary
        }
    }
}

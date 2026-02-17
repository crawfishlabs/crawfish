import SwiftUI
import CrawfishAuth

/// Beautiful, non-blocking upgrade prompt shown when a user hits a paywalled feature.
/// Always dismissible — never blocks the user.
public struct UpgradePromptView: View {
    let appId: AppId
    let featureName: String
    let onDismiss: () -> Void
    let onUpgrade: () -> Void

    @State private var isAnnual = true

    public init(
        appId: AppId,
        featureName: String = "this feature",
        onDismiss: @escaping () -> Void,
        onUpgrade: @escaping () -> Void
    ) {
        self.appId = appId
        self.featureName = featureName
        self.onDismiss = onDismiss
        self.onUpgrade = onUpgrade
    }

    private var planName: String {
        "Crawfish \(appId.rawValue.capitalized) Pro"
    }

    private var monthlyPrice: Double {
        switch appId {
        case .fitness, .nutrition, .budget: return 6.99
        case .meetings: return 9.99
        }
    }

    private var yearlyPrice: Double {
        switch appId {
        case .fitness, .nutrition, .budget: return 49.99
        case .meetings: return 79.99
        }
    }

    public var body: some View {
        VStack(spacing: 0) {
            // Dismiss handle
            HStack {
                Spacer()
                Button(action: onDismiss) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.title2)
                        .foregroundStyle(.secondary)
                }
                .padding()
            }

            ScrollView {
                VStack(spacing: 24) {
                    // Hero
                    Image(systemName: "sparkles")
                        .font(.system(size: 48))
                        .foregroundStyle(.yellow)

                    Text("Unlock \(featureName)")
                        .font(.title2.bold())
                        .multilineTextAlignment(.center)

                    // Benefits
                    VStack(alignment: .leading, spacing: 12) {
                        benefitRow("Unlimited AI queries", icon: "brain")
                        benefitRow("5 GB storage", icon: "externaldrive.fill")
                        benefitRow("Export your data", icon: "square.and.arrow.up")
                        if appId == .budget {
                            benefitRow("Partner sharing", icon: "person.2.fill")
                        }
                    }
                    .padding(.horizontal)

                    // Pricing toggle
                    Picker("Billing", selection: $isAnnual) {
                        Text("Monthly").tag(false)
                        Text("Annual (Save 40%)").tag(true)
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal)

                    // Price display
                    VStack(spacing: 4) {
                        if isAnnual {
                            Text("$\(yearlyPrice / 12, specifier: "%.2f")/month")
                                .font(.title.bold())
                            Text("Billed as $\(yearlyPrice, specifier: "%.2f")/year")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        } else {
                            Text("$\(monthlyPrice, specifier: "%.2f")/month")
                                .font(.title.bold())
                        }
                    }

                    // CTA
                    Button(action: onUpgrade) {
                        Text("Upgrade to \(planName)")
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 4)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.red)
                    .padding(.horizontal)

                    // Social proof
                    HStack(spacing: 4) {
                        ForEach(0..<5) { _ in
                            Image(systemName: "star.fill")
                                .foregroundStyle(.yellow)
                                .font(.caption)
                        }
                        Text("Join 1,000+ users")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    // Skip
                    Button("Not now") { onDismiss() }
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .padding(.bottom, 32)
                }
            }
        }
        .background(Color(.systemBackground))
    }

    private func benefitRow(_ text: String, icon: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .foregroundStyle(.red)
                .frame(width: 24)
            Text(text)
                .font(.body)
        }
    }
}

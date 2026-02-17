import SwiftUI
import CrawfishAuth

public struct PlanSelectionView: View {
    @StateObject private var auth = CrawfishAuth.shared
    @State private var isAnnual = true
    @State private var selectedPlan: String?

    public init() {}

    private let plans: [(id: String, name: String, monthly: Double, yearly: Double, apps: String, highlight: Bool)] = [
        ("free", "Free", 0, 0, "All apps with limits", false),
        ("fitness_pro", "Fitness Pro", 6.99, 49.99, "Unlimited fitness AI", false),
        ("nutrition_pro", "Nutrition Pro", 6.99, 49.99, "Unlimited nutrition AI", false),
        ("health_bundle", "Health Bundle", 9.99, 79.99, "Fitness + Nutrition", true),
        ("budget_pro", "Budget Pro", 6.99, 49.99, "Partner sharing included", false),
        ("meetings_pro", "Meetings Pro", 9.99, 79.99, "Unlimited meeting AI", false),
        ("all_access", "All Access", 19.99, 149.99, "Everything, unlimited", true),
    ]

    public var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                Text("Choose Your Plan")
                    .font(.title.bold())

                // Annual toggle
                Picker("Billing", selection: $isAnnual) {
                    Text("Monthly").tag(false)
                    HStack {
                        Text("Annual")
                        Text("Save 40%").font(.caption2).foregroundStyle(.green)
                    }.tag(true)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)

                // Plan cards
                ForEach(plans, id: \.id) { plan in
                    PlanCard(
                        name: plan.name,
                        price: isAnnual ? plan.yearly / 12 : plan.monthly,
                        period: isAnnual ? "/mo (billed annually)" : "/month",
                        description: plan.apps,
                        isHighlighted: plan.highlight,
                        isSelected: auth.currentUser?.plan.id == plan.id,
                        isCurrent: auth.currentUser?.plan.id == plan.id
                    ) {
                        selectedPlan = plan.id
                    }
                }

                Spacer(minLength: 40)
            }
            .padding()
        }
    }
}

private struct PlanCard: View {
    let name: String
    let price: Double
    let period: String
    let description: String
    let isHighlighted: Bool
    let isSelected: Bool
    let isCurrent: Bool
    let onSelect: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(name).font(.headline)
                Spacer()
                if isCurrent {
                    Text("Current").font(.caption).padding(.horizontal, 8).padding(.vertical, 4)
                        .background(.green.opacity(0.2)).clipShape(Capsule())
                }
            }

            HStack(alignment: .firstTextBaseline) {
                if price == 0 {
                    Text("Free").font(.title2.bold())
                } else {
                    Text("$\(price, specifier: "%.2f")").font(.title2.bold())
                    Text(period).font(.caption).foregroundStyle(.secondary)
                }
            }

            Text(description).font(.subheadline).foregroundStyle(.secondary)

            if !isCurrent {
                Button(price == 0 ? "Downgrade" : "Upgrade") { onSelect() }
                    .buttonStyle(.borderedProminent)
                    .tint(isHighlighted ? .red : .blue)
                    .frame(maxWidth: .infinity)
            }
        }
        .padding()
        .background(isHighlighted ? Color.red.opacity(0.05) : Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(isHighlighted ? Color.red.opacity(0.3) : .clear, lineWidth: 2)
        )
    }
}

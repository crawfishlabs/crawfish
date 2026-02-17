import Foundation

// MARK: - App Identifiers

public enum AppId: String, Codable, CaseIterable {
    case fitness
    case nutrition
    case budget
    case meetings
}

// MARK: - Plan

public struct Plan: Codable, Identifiable {
    public let id: String
    public let name: String
    public let tier: PlanTier
    public let priceMonthly: Double
    public let priceYearly: Double
    public let apps: [AppId]
    public let features: [String: AnyCodableValue]
}

public enum PlanTier: String, Codable {
    case free
    case individual
    case bundle
    case allAccess = "all_access"
}

// MARK: - Entitlements

public struct Entitlements: Codable {
    public let apps: [String: AppEntitlement]
    public let globalFeatures: [String: AnyCodableValue]

    public func forApp(_ appId: AppId) -> AppEntitlement? {
        apps[appId.rawValue]
    }
}

public struct AppEntitlement: Codable {
    public let hasAccess: Bool
    public let tier: String
    public let expiresAt: Date?
    public let aiQueriesPerDay: Int
    public let storageGb: Double
    public let features: [String: AnyCodableValue]
}

// MARK: - User

public struct CrawfishUser: Codable, Identifiable {
    public let uid: String
    public let email: String
    public var displayName: String?
    public var photoUrl: String?
    public let createdAt: Date
    public var lastLoginAt: Date
    public var plan: Plan
    public var billingStatus: String
    public var trialEndsAt: Date?
    public var entitlements: Entitlements
    public var timezone: String
    public var locale: String
    public var onboardingCompleted: Bool

    public var id: String { uid }
}

// MARK: - Shared Access

public struct SharedAccess: Codable, Identifiable {
    public let id: String
    public let resourceType: String
    public let resourceId: String
    public let ownerUid: String
    public let sharedWithUid: String
    public let role: String
    public let appId: AppId
    public let grantedAt: Date
    public let expiresAt: Date?
}

// MARK: - Flexible JSON Value

public enum AnyCodableValue: Codable {
    case bool(Bool)
    case int(Int)
    case double(Double)
    case string(String)

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let v = try? container.decode(Bool.self) { self = .bool(v) }
        else if let v = try? container.decode(Int.self) { self = .int(v) }
        else if let v = try? container.decode(Double.self) { self = .double(v) }
        else if let v = try? container.decode(String.self) { self = .string(v) }
        else { throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported value") }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .bool(let v): try container.encode(v)
        case .int(let v): try container.encode(v)
        case .double(let v): try container.encode(v)
        case .string(let v): try container.encode(v)
        }
    }

    public var boolValue: Bool? {
        if case .bool(let v) = self { return v }
        return nil
    }

    public var numberValue: Double? {
        switch self {
        case .int(let v): return Double(v)
        case .double(let v): return v
        default: return nil
        }
    }
}

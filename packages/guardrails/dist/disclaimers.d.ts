/**
 * @fileoverview Disclaimer constants for all Claw domains
 * @description Centralized disclaimer text, i18n-ready structure (English first)
 */
export type Domain = 'fitness' | 'nutrition' | 'finance' | 'meetings';
export type DisclaimerLength = 'short' | 'full';
export type Locale = 'en';
export interface DisclaimerSet {
    short: string;
    full: string;
}
export type DisclaimerMap = Record<Domain, Record<Locale, DisclaimerSet>>;
export declare const DISCLAIMERS: DisclaimerMap;
/**
 * Get disclaimer text for a domain
 */
export declare function getDisclaimer(domain: Domain, length?: DisclaimerLength, locale?: Locale): string;

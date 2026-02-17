"use strict";
/**
 * @fileoverview Disclaimer constants for all Claw domains
 * @description Centralized disclaimer text, i18n-ready structure (English first)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DISCLAIMERS = void 0;
exports.getDisclaimer = getDisclaimer;
exports.DISCLAIMERS = {
    fitness: {
        en: {
            short: 'Not medical advice. Consult a healthcare professional before starting any exercise program.',
            full: 'Claw Fitness provides general fitness information and AI-powered coaching for educational purposes only. It is not a substitute for professional medical advice, diagnosis, or treatment. Always consult your physician or qualified healthcare provider before beginning any exercise program, especially if you have pre-existing health conditions, injuries, or concerns. Stop exercising immediately if you experience pain, dizziness, or shortness of breath.',
        },
    },
    nutrition: {
        en: {
            short: 'Not medical or dietary advice. Consult a healthcare professional for personalized nutrition guidance.',
            full: 'Claw Nutrition provides general nutritional information and AI-powered guidance for educational purposes only. It is not a substitute for professional medical or dietary advice. Nutritional estimates are approximate and may not account for individual health conditions, allergies, or medications. Always consult a registered dietitian or healthcare provider for personalized nutrition plans, especially if you have dietary restrictions, eating disorders, or medical conditions.',
        },
    },
    finance: {
        en: {
            short: 'Not financial advice. Consult a qualified financial advisor for personalized guidance.',
            full: 'Claw Budget provides general financial information and AI-powered budgeting assistance for educational purposes only. It is not a substitute for professional financial advice. Claw does not provide investment, tax, legal, or accounting advice. Always consult a qualified financial advisor, accountant, or tax professional before making financial decisions. Past spending patterns do not guarantee future results.',
        },
    },
    meetings: {
        en: {
            short: 'AI-generated insights are approximate. Review all action items and summaries for accuracy.',
            full: 'Claw Meetings provides AI-powered meeting analysis, transcription, and leadership coaching for informational purposes only. Transcriptions and summaries may contain inaccuracies. Leadership scores and coaching suggestions are AI-generated assessments and should not be used as the sole basis for employment, promotion, or performance decisions. Always verify action items and key decisions with meeting participants.',
        },
    },
};
/**
 * Get disclaimer text for a domain
 */
function getDisclaimer(domain, length = 'short', locale = 'en') {
    const domainDisclaimers = exports.DISCLAIMERS[domain];
    if (!domainDisclaimers) {
        throw new Error(`Unknown domain: ${domain}`);
    }
    const localeDisclaimers = domainDisclaimers[locale];
    if (!localeDisclaimers) {
        throw new Error(`Unsupported locale: ${locale} for domain: ${domain}`);
    }
    return localeDisclaimers[length];
}

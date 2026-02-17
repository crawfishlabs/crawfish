import { DescriptorCleaner } from '../src/descriptor-cleaner';

const cleaner = new DescriptorCleaner();

describe('DescriptorCleaner', () => {
  describe('clean()', () => {
    const testCases: [string, Partial<{ cleanName: string; paymentProcessor: string; location: string }>][] = [
      // Amazon variants
      ['AMZN MKTP US*2K7X1B3R0 AMZN.COM/BILLWA', { paymentProcessor: 'Amazon' }],
      ['AMZN Mktp US*1A2B3C4D5', { paymentProcessor: 'Amazon' }],
      ['Amazon.com*2K7X1B3R0', { paymentProcessor: 'Amazon' }],
      // Square merchants
      ['SQ *BLUE BOTTLE COFF San Francisco CA', { paymentProcessor: 'Square', location: 'San Francisco, CA' }],
      ['SQ *SALT AND STRAW Portland OR', { paymentProcessor: 'Square', location: 'Portland, OR' }],
      // PayPal
      ['PAYPAL *SPOTIFY 402-935-7733', { paymentProcessor: 'PayPal' }],
      ['PAYPAL *EBAY 402-935-7733', { paymentProcessor: 'PayPal' }],
      // Toast
      ['TST* Shake Shack 129 NEW YORK NY', { paymentProcessor: 'Toast', location: 'New York, NY' }],
      ['TST*Sweetgreen DC 123 WASHINGTON DC', { paymentProcessor: 'Toast' }],
      // Whole Foods
      ['WHOLEFDS MKT 10847 SILVER SPRING MD', { location: 'Silver Spring, MD' }],
      // Chick-fil-A
      ['CHICK-FIL-A #0374 BETHESDA MD', { location: 'Bethesda, MD' }],
      // AT&T
      ['ATT*BILL PAYMENT 800-288-2020 TX', { paymentProcessor: 'AT&T' }],
      // Venmo
      ['VENMO *JOHN-SMITH 855-812-4430', { paymentProcessor: 'Venmo' }],
      // Check card purchase
      ['CHECK CRD PURCHASE 02/14 WAWA 0456 COLLEGE PARK MD', { location: 'College Park, MD' }],
      // Misc real descriptors
      ['POS PURCHASE 01/15 TARGET T-1234 ROCKVILLE MD', {}],
      ['RECURRING PAYMENT NETFLIX.COM', {}],
      ['DEBIT CRD PURCHASE 03/22 COSTCO WHSE #1234 GAITHERSBURG MD', {}],
      ['UBER *TRIP HELP.UBER.COM', {}],
      ['LYFT *RIDE THU 8PM', {}],
      // Gas stations
      ['SHELL OIL 57442660084 COLLEGE PARK MD', { location: 'College Park, MD' }],
      ['EXXONMOBIL 12345678 BETHESDA MD', { location: 'Bethesda, MD' }],
      // Starbucks
      ['STARBUCKS STORE 12345 ARLINGTON VA', { location: 'Arlington, VA' }],
      // Subscription services
      ['SPOTIFY USA 877-778-8692', {}],
      ['NETFLIX.COM LOS GATOS CA', { location: 'Los Gatos, CA' }],
      ['HULU 877-824-4858 CA', {}],
      // Phone/utility
      ['COMCAST CABLE COMM 800-934-6489 PA', {}],
      ['VERIZON WRLS 123-456-7890 TX', {}],
      // Insurance
      ['GEICO *AUTO POLICY 800-861-8380', {}],
      // Medical
      ['KAISER PERMANENTE SAN FRANCISCO CA', { location: 'San Francisco, CA' }],
      // Grocery
      ['HARRIS TEETER #0123 BETHESDA MD', { location: 'Bethesda, MD' }],
      ['TRADER JOE S #0123 SILVER SPRING MD', { location: 'Silver Spring, MD' }],
      ['ALDI 12345 COLLEGE PARK MD', { location: 'College Park, MD' }],
      // Ride share
      ['UBER *EATS PENDING', {}],
      ['LYFT *RIDE 03/15', {}],
      // Digital
      ['APPLE.COM/BILL ONE APPLE PARK WAY', {}],
      ['GOOGLE *YOUTUBE MUSIC', {}],
      ['MICROSOFT*XBOX MSBILL.INFO WA', {}],
      // Home improvement
      ['THE HOME DEPOT #1234 ROCKVILLE MD', { location: 'Rockville, MD' }],
      ['LOWES #02345 COLLEGE PARK MD', { location: 'College Park, MD' }],
      // Restaurants
      ['CHIPOTLE 1234 BETHESDA MD', { location: 'Bethesda, MD' }],
      ['MCDONALDS F12345 SILVER SPRING MD', { location: 'Silver Spring, MD' }],
      ['PANERA BREAD #123456 ROCKVILLE MD', { location: 'Rockville, MD' }],
      // Clothing
      ['NORDSTROM RACK #0123 BETHESDA MD', { location: 'Bethesda, MD' }],
      ['TJ MAXX #1234 COLLEGE PARK MD', { location: 'College Park, MD' }],
      // Misc
      ['DOORDASH*ORDER DASHER 855-431-0459', {}],
      ['INSTACART HTTPSINSTACAR 888-246-7822 CA', {}],
      ['AIRBNB *HMCF6X7B3R SAN FRANCISCO CA', { location: 'San Francisco, CA' }],
      ['PLANET FITNESS CLUB FEE HAMPTON NH', { location: 'Hampton, NH' }],
      ['CVS/PHARMACY #1234 BETHESDA MD', { location: 'Bethesda, MD' }],
      ['WALGREENS #12345 SILVER SPRING MD', { location: 'Silver Spring, MD' }],
    ];

    test.each(testCases)('cleans "%s"', (input, expected) => {
      const result = cleaner.clean(input);
      expect(result.originalDescriptor).toBe(input);
      expect(result.cleanName).toBeTruthy();
      expect(result.cleanName.length).toBeGreaterThan(0);
      // Should not contain phone numbers
      expect(result.cleanName).not.toMatch(/\d{3}[-.]?\d{3}[-.]?\d{4}/);

      if (expected.paymentProcessor) {
        expect(result.paymentProcessor).toBe(expected.paymentProcessor);
      }
      if (expected.location) {
        expect(result.location).toBe(expected.location);
      }
    });
  });

  describe('matchKnownMerchant()', () => {
    const merchantTests: [string, string | null][] = [
      ['AMZN MKTP US', 'Amazon'],
      ['AMAZON.COM', 'Amazon'],
      ['WHOLEFDS MKT 10847', 'Whole Foods'],
      ['WHOLE FOODS', 'Whole Foods'],
      ['CHICK-FIL-A #0374', 'Chick-fil-A'],
      ['NETFLIX.COM', 'Netflix'],
      ['STARBUCKS STORE 12345', 'Starbucks'],
      ['MCDONALDS F12345', "McDonald's"],
      ['COSTCO WHSE', 'Costco'],
      ['TARGET T-1234', 'Target'],
      ['WALMART SC', 'Walmart'],
      ['KROGER #12345', 'Kroger'],
      ['WAWA 0456', 'Wawa'],
      ['SHELL OIL 574', 'Shell'],
      ['UBER TRIP', 'Uber'],
      ['LYFT RIDE', 'Lyft'],
      ['SPOTIFY', 'Spotify'],
      ['CHIPOTLE', 'Chipotle'],
      ['HOME DEPOT', 'Home Depot'],
      ['LOWES', "Lowe's"],
      ['CVS/PHARMACY', 'CVS'],
      ['WALGREENS', 'Walgreens'],
      ['SOME RANDOM STORE', null],
      ['XYZ MERCHANT 123', null],
    ];

    test.each(merchantTests)('matches "%s" → %s', (input, expected) => {
      const result = cleaner.matchKnownMerchant(input);
      if (expected) {
        expect(result).not.toBeNull();
        expect(result!.name).toBe(expected);
      } else {
        expect(result).toBeNull();
      }
    });
  });

  describe('cleanAndMatch()', () => {
    test('handles full pipeline for messy descriptors', () => {
      const result = cleaner.cleanAndMatch('AMZN MKTP US*2K7X1B3R0 AMZN.COM/BILLWA');
      expect(result.merchant).not.toBeNull();
      expect(result.merchant!.name).toBe('Amazon');
    });

    test('handles SQ * prefix with merchant', () => {
      const result = cleaner.cleanAndMatch('SQ *BLUE BOTTLE COFF San Francisco CA');
      expect(result.cleaned.paymentProcessor).toBe('Square');
      expect(result.merchant).not.toBeNull();
      expect(result.merchant!.name).toBe('Blue Bottle Coffee');
    });

    test('handles PAYPAL * prefix', () => {
      const result = cleaner.cleanAndMatch('PAYPAL *SPOTIFY 402-935-7733');
      expect(result.cleaned.paymentProcessor).toBe('PayPal');
      expect(result.merchant).not.toBeNull();
      expect(result.merchant!.name).toBe('Spotify');
    });

    test('handles CHECK CRD PURCHASE prefix', () => {
      const result = cleaner.cleanAndMatch('CHECK CRD PURCHASE 02/14 WAWA 0456 COLLEGE PARK MD');
      expect(result.merchant).not.toBeNull();
      expect(result.merchant!.name).toBe('Wawa');
    });
  });
});

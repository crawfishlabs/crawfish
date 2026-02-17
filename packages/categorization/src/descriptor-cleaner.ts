import { CleanedDescriptor, KnownMerchant } from './models';

// ─── Payment processor prefixes to strip ─────────────────────────────────────

const PAYMENT_PROCESSORS: { prefix: RegExp; name: string }[] = [
  { prefix: /^SQ \*/i, name: 'Square' },
  { prefix: /^SQC\*/i, name: 'Square Cash' },
  { prefix: /^TST\*\s*/i, name: 'Toast' },
  { prefix: /^PAYPAL \*/i, name: 'PayPal' },
  { prefix: /^PP\*/i, name: 'PayPal' },
  { prefix: /^VENMO \*/i, name: 'Venmo' },
  { prefix: /^ZELLE \*/i, name: 'Zelle' },
  { prefix: /^CASHAPP\*/i, name: 'Cash App' },
  { prefix: /^GOOGLE \*/i, name: 'Google Pay' },
  { prefix: /^APPLE\.COM\/BILL/i, name: 'Apple' },
  { prefix: /^APL\*\s*/i, name: 'Apple' },
  { prefix: /^AMZN MKTP /i, name: 'Amazon' },
  { prefix: /^AMZN /i, name: 'Amazon' },
  { prefix: /^Amazon\.com\*/i, name: 'Amazon' },
  { prefix: /^STRIPE \*/i, name: 'Stripe' },
  { prefix: /^SP \*/i, name: 'Shopify' },
  { prefix: /^IN \*/i, name: 'Invoice Ninja' },
  { prefix: /^CKO\*/i, name: 'Checkout.com' },
  { prefix: /^WPY\*/i, name: 'WorldPay' },
  { prefix: /^ATT\*/i, name: 'AT&T' },
  { prefix: /^CHECK CRD PURCHASE \d{2}\/\d{2}\s*/i, name: '' },
  { prefix: /^POS PURCHASE \d{2}\/\d{2}\s*/i, name: '' },
  { prefix: /^DEBIT CRD PURCHASE \d{2}\/\d{2}\s*/i, name: '' },
  { prefix: /^RECURRING PAYMENT /i, name: '' },
  { prefix: /^PREAUTHORIZED ACH /i, name: '' },
  { prefix: /^ACH PMT /i, name: '' },
  { prefix: /^ELECTRONIC PMT /i, name: '' },
  { prefix: /^ONLINE PMT /i, name: '' },
];

// ─── Patterns to remove from descriptors ─────────────────────────────────────

const CLEANUP_PATTERNS: RegExp[] = [
  // Transaction IDs / reference numbers
  /\*[A-Z0-9]{6,}/g,
  /\#\d{3,}/g,
  /REF[\s#:]*[A-Z0-9]+/gi,
  /TRANS[\s#:]*[A-Z0-9]+/gi,
  /TRACE[\s#:]*\d+/gi,
  // URLs
  /[A-Za-z]+\.(COM|NET|ORG)(\/\S*)?/gi,
  // Phone numbers
  /\d{3}[-.]?\d{3}[-.]?\d{4}/g,
  // Dates embedded in descriptors
  /\b\d{2}\/\d{2}(\/\d{2,4})?\b/g,
  // Card last 4
  /\bX{4,}\d{4}\b/g,
  /\bENDING IN \d{4}\b/gi,
];

// ─── Location pattern (city/state/zip at end) ────────────────────────────────

const LOCATION_PATTERN = /\b([A-Z][A-Za-z\s.'-]+)\s+([A-Z]{2})(\s+\d{5}(-\d{4})?)?\s*$/;
const US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS',
  'KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY',
  'NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV',
  'WI','WY','DC','PR','VI','GU','AS','MP',
]);

// ─── Known Merchants Database (200+) ─────────────────────────────────────────

const KNOWN_MERCHANTS: KnownMerchant[] = [
  // ── Amazon / E-commerce ──
  { name: 'Amazon', patterns: ['AMZN', 'AMAZON', 'AMZ MKTP', 'AMZN MKTP', 'AMAZON.COM', 'PRIME VIDEO', 'AMAZON PRIME'], defaultCategory: 'Shopping', logoUrl: 'https://logo.clearbit.com/amazon.com' },
  { name: 'eBay', patterns: ['EBAY', 'PAYPAL *EBAY'], defaultCategory: 'Shopping', logoUrl: 'https://logo.clearbit.com/ebay.com' },
  { name: 'Etsy', patterns: ['ETSY', 'ETSY.COM'], defaultCategory: 'Shopping', logoUrl: 'https://logo.clearbit.com/etsy.com' },
  { name: 'Wish', patterns: ['WISH.COM', 'WISH '], defaultCategory: 'Shopping', logoUrl: 'https://logo.clearbit.com/wish.com' },
  { name: 'Shopify', patterns: ['SHOPIFY'], defaultCategory: 'Shopping', logoUrl: 'https://logo.clearbit.com/shopify.com' },

  // ── Big Box / Department ──
  { name: 'Walmart', patterns: ['WALMART', 'WAL-MART', 'WM SUPERCENTER', 'WMSC'], defaultCategory: 'Shopping', logoUrl: 'https://logo.clearbit.com/walmart.com' },
  { name: 'Target', patterns: ['TARGET'], defaultCategory: 'Shopping', logoUrl: 'https://logo.clearbit.com/target.com' },
  { name: 'Costco', patterns: ['COSTCO', 'COSTCO WHSE'], defaultCategory: 'Groceries', logoUrl: 'https://logo.clearbit.com/costco.com' },
  { name: "Sam's Club", patterns: ['SAMS CLUB', "SAM'S CLUB", 'SAMSCLUB'], defaultCategory: 'Groceries', logoUrl: 'https://logo.clearbit.com/samsclub.com' },
  { name: "BJ's Wholesale", patterns: ["BJ'S WHOLESALE", 'BJS WHOLESALE', "BJ'S"], defaultCategory: 'Groceries' },
  { name: 'Kohl\'s', patterns: ['KOHLS', "KOHL'S"], defaultCategory: 'Clothing', logoUrl: 'https://logo.clearbit.com/kohls.com' },
  { name: 'Macy\'s', patterns: ['MACYS', "MACY'S"], defaultCategory: 'Clothing', logoUrl: 'https://logo.clearbit.com/macys.com' },
  { name: 'Nordstrom', patterns: ['NORDSTROM', 'NORDSTRM'], defaultCategory: 'Clothing', logoUrl: 'https://logo.clearbit.com/nordstrom.com' },
  { name: 'TJ Maxx', patterns: ['TJ MAXX', 'TJMAXX', 'TJX'], defaultCategory: 'Clothing', logoUrl: 'https://logo.clearbit.com/tjmaxx.com' },
  { name: 'Marshalls', patterns: ['MARSHALLS'], defaultCategory: 'Clothing' },
  { name: 'Ross', patterns: ['ROSS STORES', 'ROSS DRESS'], defaultCategory: 'Clothing' },
  { name: 'Burlington', patterns: ['BURLINGTON'], defaultCategory: 'Clothing' },
  { name: 'Dollar Tree', patterns: ['DOLLAR TREE', 'DOLLARTREE'], defaultCategory: 'Shopping' },
  { name: 'Dollar General', patterns: ['DOLLAR GENERAL', 'DOLLARGENERAL', 'DG '], defaultCategory: 'Shopping' },
  { name: 'Five Below', patterns: ['FIVE BELOW'], defaultCategory: 'Shopping' },
  { name: 'Big Lots', patterns: ['BIG LOTS'], defaultCategory: 'Shopping' },
  { name: 'Bed Bath & Beyond', patterns: ['BED BATH', 'BBB '], defaultCategory: 'Home Improvement' },
  { name: 'IKEA', patterns: ['IKEA'], defaultCategory: 'Home Improvement', logoUrl: 'https://logo.clearbit.com/ikea.com' },
  { name: 'JCPenney', patterns: ['JCPENNEY', 'JC PENNEY'], defaultCategory: 'Clothing' },
  { name: 'Sears', patterns: ['SEARS'], defaultCategory: 'Shopping' },

  // ── Grocery ──
  { name: 'Whole Foods', patterns: ['WHOLEFDS', 'WHOLE FOODS', 'WHOLEFOODS', 'WFM'], defaultCategory: 'Groceries', logoUrl: 'https://logo.clearbit.com/wholefoods.com' },
  { name: 'Trader Joe\'s', patterns: ['TRADER JOE', 'TRADER JO', 'TJ '], defaultCategory: 'Groceries', logoUrl: 'https://logo.clearbit.com/traderjoes.com' },
  { name: 'Kroger', patterns: ['KROGER'], defaultCategory: 'Groceries', logoUrl: 'https://logo.clearbit.com/kroger.com' },
  { name: 'Safeway', patterns: ['SAFEWAY'], defaultCategory: 'Groceries', logoUrl: 'https://logo.clearbit.com/safeway.com' },
  { name: 'Publix', patterns: ['PUBLIX'], defaultCategory: 'Groceries', logoUrl: 'https://logo.clearbit.com/publix.com' },
  { name: 'Wegmans', patterns: ['WEGMANS'], defaultCategory: 'Groceries', logoUrl: 'https://logo.clearbit.com/wegmans.com' },
  { name: 'Aldi', patterns: ['ALDI'], defaultCategory: 'Groceries', logoUrl: 'https://logo.clearbit.com/aldi.com' },
  { name: 'Lidl', patterns: ['LIDL'], defaultCategory: 'Groceries', logoUrl: 'https://logo.clearbit.com/lidl.com' },
  { name: 'H-E-B', patterns: ['HEB ', 'H-E-B', 'H E B'], defaultCategory: 'Groceries' },
  { name: 'Meijer', patterns: ['MEIJER'], defaultCategory: 'Groceries' },
  { name: 'Food Lion', patterns: ['FOOD LION'], defaultCategory: 'Groceries' },
  { name: 'Giant', patterns: ['GIANT FOOD', 'GIANT #'], defaultCategory: 'Groceries' },
  { name: 'Stop & Shop', patterns: ['STOP & SHOP', 'STOP AND SHOP', 'STOPNSHOP'], defaultCategory: 'Groceries' },
  { name: 'ShopRite', patterns: ['SHOPRITE'], defaultCategory: 'Groceries' },
  { name: 'Winn-Dixie', patterns: ['WINN-DIXIE', 'WINN DIXIE'], defaultCategory: 'Groceries' },
  { name: 'Albertsons', patterns: ['ALBERTSONS'], defaultCategory: 'Groceries' },
  { name: 'Vons', patterns: ['VONS'], defaultCategory: 'Groceries' },
  { name: 'Harris Teeter', patterns: ['HARRIS TEETER', 'HARRISTEETER'], defaultCategory: 'Groceries' },
  { name: 'Sprouts', patterns: ['SPROUTS'], defaultCategory: 'Groceries' },
  { name: 'Fresh Market', patterns: ['FRESH MARKET'], defaultCategory: 'Groceries' },
  { name: 'Piggly Wiggly', patterns: ['PIGGLY WIGGLY'], defaultCategory: 'Groceries' },
  { name: 'Instacart', patterns: ['INSTACART'], defaultCategory: 'Groceries', logoUrl: 'https://logo.clearbit.com/instacart.com' },

  // ── Gas Stations ──
  { name: 'Shell', patterns: ['SHELL'], defaultCategory: 'Auto & Gas', logoUrl: 'https://logo.clearbit.com/shell.com' },
  { name: 'Exxon', patterns: ['EXXON', 'EXXONMOBIL'], defaultCategory: 'Auto & Gas', logoUrl: 'https://logo.clearbit.com/exxon.com' },
  { name: 'Chevron', patterns: ['CHEVRON'], defaultCategory: 'Auto & Gas', logoUrl: 'https://logo.clearbit.com/chevron.com' },
  { name: 'BP', patterns: ['BP#', 'BP '], defaultCategory: 'Auto & Gas', logoUrl: 'https://logo.clearbit.com/bp.com' },
  { name: 'Mobil', patterns: ['MOBIL'], defaultCategory: 'Auto & Gas' },
  { name: 'Sunoco', patterns: ['SUNOCO'], defaultCategory: 'Auto & Gas', logoUrl: 'https://logo.clearbit.com/sunoco.com' },
  { name: 'Speedway', patterns: ['SPEEDWAY'], defaultCategory: 'Auto & Gas' },
  { name: 'Circle K', patterns: ['CIRCLE K'], defaultCategory: 'Auto & Gas' },
  { name: 'Wawa', patterns: ['WAWA'], defaultCategory: 'Auto & Gas', logoUrl: 'https://logo.clearbit.com/wawa.com' },
  { name: 'Sheetz', patterns: ['SHEETZ'], defaultCategory: 'Auto & Gas' },
  { name: 'QuikTrip', patterns: ['QUIKTRIP', 'QT '], defaultCategory: 'Auto & Gas' },
  { name: 'RaceTrac', patterns: ['RACETRAC'], defaultCategory: 'Auto & Gas' },
  { name: 'Murphy USA', patterns: ['MURPHY USA', 'MURPHYUSA'], defaultCategory: 'Auto & Gas' },
  { name: 'Valero', patterns: ['VALERO'], defaultCategory: 'Auto & Gas' },
  { name: 'Phillips 66', patterns: ['PHILLIPS 66'], defaultCategory: 'Auto & Gas' },
  { name: '76', patterns: ['76 -'], defaultCategory: 'Auto & Gas' },
  { name: 'Marathon', patterns: ['MARATHON'], defaultCategory: 'Auto & Gas' },
  { name: 'Casey\'s', patterns: ["CASEY'S", 'CASEYS'], defaultCategory: 'Auto & Gas' },
  { name: 'Pilot', patterns: ['PILOT TRAVEL', 'PILOT '], defaultCategory: 'Auto & Gas' },
  { name: 'Love\'s', patterns: ["LOVE'S", 'LOVES TRAVEL'], defaultCategory: 'Auto & Gas' },
  { name: 'Buc-ee\'s', patterns: ["BUC-EE'S", 'BUCEES'], defaultCategory: 'Auto & Gas' },
  { name: 'GetGo', patterns: ['GETGO'], defaultCategory: 'Auto & Gas' },
  { name: 'Cumberland Farms', patterns: ['CUMBERLAND FARMS', 'CUMBERLND'], defaultCategory: 'Auto & Gas' },
  { name: 'Kum & Go', patterns: ['KUM & GO', 'KUM&GO'], defaultCategory: 'Auto & Gas' },
  { name: 'Tesla Supercharger', patterns: ['TESLA SUPERCHARGER', 'TESLA ENERGY'], defaultCategory: 'Auto & Gas' },
  { name: 'ChargePoint', patterns: ['CHARGEPOINT'], defaultCategory: 'Auto & Gas' },

  // ── Fast Food / Quick Service ──
  { name: "McDonald's", patterns: ['MCDONALDS', "MCDONALD'S", 'MCD '], defaultCategory: 'Eating Out', logoUrl: 'https://logo.clearbit.com/mcdonalds.com' },
  { name: 'Starbucks', patterns: ['STARBUCKS', 'SBUX'], defaultCategory: 'Eating Out', logoUrl: 'https://logo.clearbit.com/starbucks.com' },
  { name: 'Chick-fil-A', patterns: ['CHICK-FIL', 'CHICKFIL'], defaultCategory: 'Eating Out', logoUrl: 'https://logo.clearbit.com/chick-fil-a.com' },
  { name: 'Chipotle', patterns: ['CHIPOTLE'], defaultCategory: 'Eating Out', logoUrl: 'https://logo.clearbit.com/chipotle.com' },
  { name: 'Taco Bell', patterns: ['TACO BELL'], defaultCategory: 'Eating Out', logoUrl: 'https://logo.clearbit.com/tacobell.com' },
  { name: 'Burger King', patterns: ['BURGER KING', 'BK #'], defaultCategory: 'Eating Out', logoUrl: 'https://logo.clearbit.com/burgerking.com' },
  { name: "Wendy's", patterns: ['WENDYS', "WENDY'S"], defaultCategory: 'Eating Out', logoUrl: 'https://logo.clearbit.com/wendys.com' },
  { name: 'Subway', patterns: ['SUBWAY'], defaultCategory: 'Eating Out', logoUrl: 'https://logo.clearbit.com/subway.com' },
  { name: 'Dunkin\'', patterns: ['DUNKIN', "DUNKIN'"], defaultCategory: 'Eating Out', logoUrl: 'https://logo.clearbit.com/dunkindonuts.com' },
  { name: 'Popeyes', patterns: ['POPEYES'], defaultCategory: 'Eating Out' },
  { name: 'KFC', patterns: ['KFC'], defaultCategory: 'Eating Out', logoUrl: 'https://logo.clearbit.com/kfc.com' },
  { name: 'Panera Bread', patterns: ['PANERA'], defaultCategory: 'Eating Out', logoUrl: 'https://logo.clearbit.com/panerabread.com' },
  { name: "Domino's", patterns: ['DOMINOS', "DOMINO'S"], defaultCategory: 'Eating Out', logoUrl: 'https://logo.clearbit.com/dominos.com' },
  { name: 'Pizza Hut', patterns: ['PIZZA HUT'], defaultCategory: 'Eating Out', logoUrl: 'https://logo.clearbit.com/pizzahut.com' },
  { name: "Papa John's", patterns: ["PAPA JOHN", 'PAPAJOHNS'], defaultCategory: 'Eating Out' },
  { name: 'Five Guys', patterns: ['FIVE GUYS'], defaultCategory: 'Eating Out' },
  { name: 'Shake Shack', patterns: ['SHAKE SHACK'], defaultCategory: 'Eating Out' },
  { name: 'In-N-Out', patterns: ['IN-N-OUT', 'INNOUT', 'IN N OUT'], defaultCategory: 'Eating Out' },
  { name: "Arby's", patterns: ['ARBYS', "ARBY'S"], defaultCategory: 'Eating Out' },
  { name: 'Sonic', patterns: ['SONIC DRIVE'], defaultCategory: 'Eating Out' },
  { name: "Zaxby's", patterns: ['ZAXBYS', "ZAXBY'S"], defaultCategory: 'Eating Out' },
  { name: "Raising Cane's", patterns: ["RAISING CANE", 'RAISINGCANE'], defaultCategory: 'Eating Out' },
  { name: 'Wingstop', patterns: ['WINGSTOP'], defaultCategory: 'Eating Out' },
  { name: 'Panda Express', patterns: ['PANDA EXPRESS', 'PANDA EXP'], defaultCategory: 'Eating Out' },
  { name: 'Noodles & Company', patterns: ['NOODLES & CO', 'NOODLES&CO'], defaultCategory: 'Eating Out' },
  { name: 'Jersey Mike\'s', patterns: ["JERSEY MIKE", 'JERSEYMIKE'], defaultCategory: 'Eating Out' },
  { name: 'Jimmy John\'s', patterns: ["JIMMY JOHN", 'JIMMYJOHN'], defaultCategory: 'Eating Out' },
  { name: 'Firehouse Subs', patterns: ['FIREHOUSE SUBS'], defaultCategory: 'Eating Out' },
  { name: 'Whataburger', patterns: ['WHATABURGER'], defaultCategory: 'Eating Out' },
  { name: 'Jack in the Box', patterns: ['JACK IN THE BOX', 'JACK BOX'], defaultCategory: 'Eating Out' },
  { name: 'El Pollo Loco', patterns: ['EL POLLO LOCO'], defaultCategory: 'Eating Out' },
  { name: 'Cracker Barrel', patterns: ['CRACKER BARREL'], defaultCategory: 'Eating Out' },
  { name: 'Waffle House', patterns: ['WAFFLE HOUSE'], defaultCategory: 'Eating Out' },
  { name: 'IHOP', patterns: ['IHOP'], defaultCategory: 'Eating Out' },
  { name: "Denny's", patterns: ['DENNYS', "DENNY'S"], defaultCategory: 'Eating Out' },
  { name: 'Olive Garden', patterns: ['OLIVE GARDEN'], defaultCategory: 'Eating Out' },
  { name: 'Applebee\'s', patterns: ['APPLEBEES', "APPLEBEE'S"], defaultCategory: 'Eating Out' },
  { name: 'Chili\'s', patterns: ['CHILIS', "CHILI'S"], defaultCategory: 'Eating Out' },
  { name: 'TGI Friday\'s', patterns: ['TGI FRIDAY', 'FRIDAYS'], defaultCategory: 'Eating Out' },
  { name: 'Outback Steakhouse', patterns: ['OUTBACK'], defaultCategory: 'Eating Out' },
  { name: 'Red Lobster', patterns: ['RED LOBSTER'], defaultCategory: 'Eating Out' },
  { name: 'Texas Roadhouse', patterns: ['TEXAS ROADHOUSE'], defaultCategory: 'Eating Out' },
  { name: 'The Cheesecake Factory', patterns: ['CHEESECAKE FACTORY'], defaultCategory: 'Eating Out' },
  { name: 'Buffalo Wild Wings', patterns: ['BUFFALO WILD', 'BWW '], defaultCategory: 'Eating Out' },
  { name: 'Sweetgreen', patterns: ['SWEETGREEN'], defaultCategory: 'Eating Out' },
  { name: 'Cava', patterns: ['CAVA '], defaultCategory: 'Eating Out' },
  { name: 'Blue Bottle Coffee', patterns: ['BLUE BOTTLE'], defaultCategory: 'Eating Out' },

  // ── Coffee ──
  { name: 'Peet\'s Coffee', patterns: ["PEET'S", 'PEETS'], defaultCategory: 'Eating Out' },
  { name: 'Dutch Bros', patterns: ['DUTCH BROS'], defaultCategory: 'Eating Out' },
  { name: 'Tim Hortons', patterns: ['TIM HORTON'], defaultCategory: 'Eating Out' },
  { name: 'Caribou Coffee', patterns: ['CARIBOU'], defaultCategory: 'Eating Out' },

  // ── Food Delivery ──
  { name: 'DoorDash', patterns: ['DOORDASH', 'DD *'], defaultCategory: 'Eating Out', logoUrl: 'https://logo.clearbit.com/doordash.com' },
  { name: 'Uber Eats', patterns: ['UBER EATS', 'UBEREATS'], defaultCategory: 'Eating Out', logoUrl: 'https://logo.clearbit.com/ubereats.com' },
  { name: 'Grubhub', patterns: ['GRUBHUB'], defaultCategory: 'Eating Out', logoUrl: 'https://logo.clearbit.com/grubhub.com' },
  { name: 'Postmates', patterns: ['POSTMATES'], defaultCategory: 'Eating Out' },

  // ── Streaming / Subscriptions ──
  { name: 'Netflix', patterns: ['NETFLIX'], defaultCategory: 'Subscriptions', logoUrl: 'https://logo.clearbit.com/netflix.com' },
  { name: 'Spotify', patterns: ['SPOTIFY'], defaultCategory: 'Subscriptions', logoUrl: 'https://logo.clearbit.com/spotify.com' },
  { name: 'Apple', patterns: ['APPLE.COM/BILL', 'APPLE STORE', 'APL*'], defaultCategory: 'Subscriptions', logoUrl: 'https://logo.clearbit.com/apple.com' },
  { name: 'Disney+', patterns: ['DISNEY PLUS', 'DISNEYPLUS', 'DISNEY+'], defaultCategory: 'Subscriptions', logoUrl: 'https://logo.clearbit.com/disneyplus.com' },
  { name: 'Hulu', patterns: ['HULU'], defaultCategory: 'Subscriptions', logoUrl: 'https://logo.clearbit.com/hulu.com' },
  { name: 'HBO Max', patterns: ['HBO MAX', 'HBOMAX', 'MAX.COM'], defaultCategory: 'Subscriptions' },
  { name: 'YouTube', patterns: ['YOUTUBE', 'GOOGLE *YOUTUBE'], defaultCategory: 'Subscriptions', logoUrl: 'https://logo.clearbit.com/youtube.com' },
  { name: 'Amazon Prime Video', patterns: ['PRIME VIDEO', 'PRIMEVIDEO'], defaultCategory: 'Subscriptions' },
  { name: 'Peacock', patterns: ['PEACOCK'], defaultCategory: 'Subscriptions' },
  { name: 'Paramount+', patterns: ['PARAMOUNT+', 'PARAMOUNT PLUS'], defaultCategory: 'Subscriptions' },
  { name: 'Apple TV+', patterns: ['APPLE TV'], defaultCategory: 'Subscriptions' },
  { name: 'Audible', patterns: ['AUDIBLE'], defaultCategory: 'Subscriptions', logoUrl: 'https://logo.clearbit.com/audible.com' },
  { name: 'Kindle Unlimited', patterns: ['KINDLE'], defaultCategory: 'Subscriptions' },
  { name: 'Adobe', patterns: ['ADOBE'], defaultCategory: 'Subscriptions', logoUrl: 'https://logo.clearbit.com/adobe.com' },
  { name: 'Microsoft', patterns: ['MICROSOFT', 'MSFT'], defaultCategory: 'Subscriptions', logoUrl: 'https://logo.clearbit.com/microsoft.com' },
  { name: 'Google', patterns: ['GOOGLE *', 'GOOGLE STORAGE', 'GOOGLE ONE'], defaultCategory: 'Subscriptions', logoUrl: 'https://logo.clearbit.com/google.com' },
  { name: 'Dropbox', patterns: ['DROPBOX'], defaultCategory: 'Subscriptions', logoUrl: 'https://logo.clearbit.com/dropbox.com' },
  { name: 'iCloud', patterns: ['ICLOUD', 'APPLE.COM/BILL'], defaultCategory: 'Subscriptions' },
  { name: 'Notion', patterns: ['NOTION'], defaultCategory: 'Subscriptions' },
  { name: 'ChatGPT / OpenAI', patterns: ['OPENAI', 'CHATGPT'], defaultCategory: 'Subscriptions' },
  { name: 'Patreon', patterns: ['PATREON'], defaultCategory: 'Subscriptions' },
  { name: 'Substack', patterns: ['SUBSTACK'], defaultCategory: 'Subscriptions' },
  { name: 'Twitch', patterns: ['TWITCH'], defaultCategory: 'Subscriptions' },
  { name: 'SiriusXM', patterns: ['SIRIUSXM', 'SIRIUS'], defaultCategory: 'Subscriptions' },
  { name: 'Crunchyroll', patterns: ['CRUNCHYROLL'], defaultCategory: 'Subscriptions' },
  { name: 'Xbox', patterns: ['XBOX', 'MICROSOFT*XBOX'], defaultCategory: 'Subscriptions' },
  { name: 'PlayStation', patterns: ['PLAYSTATION', 'SONY NETWORK', 'SONY INTERACTIVE'], defaultCategory: 'Subscriptions' },
  { name: 'Nintendo', patterns: ['NINTENDO'], defaultCategory: 'Subscriptions' },
  { name: 'Peloton', patterns: ['PELOTON'], defaultCategory: 'Fitness & Sports' },

  // ── Ride Share / Transportation ──
  { name: 'Uber', patterns: ['UBER '], defaultCategory: 'Transportation', logoUrl: 'https://logo.clearbit.com/uber.com' },
  { name: 'Lyft', patterns: ['LYFT'], defaultCategory: 'Transportation', logoUrl: 'https://logo.clearbit.com/lyft.com' },

  // ── Telecom / Utilities ──
  { name: 'AT&T', patterns: ['AT&T', 'ATT BILL', 'ATT*', 'ATT PAYMENT'], defaultCategory: 'Utilities', logoUrl: 'https://logo.clearbit.com/att.com' },
  { name: 'Verizon', patterns: ['VERIZON', 'VZ WIRELESS'], defaultCategory: 'Utilities', logoUrl: 'https://logo.clearbit.com/verizon.com' },
  { name: 'T-Mobile', patterns: ['T-MOBILE', 'TMOBILE'], defaultCategory: 'Utilities', logoUrl: 'https://logo.clearbit.com/t-mobile.com' },
  { name: 'Sprint', patterns: ['SPRINT'], defaultCategory: 'Utilities' },
  { name: 'Comcast', patterns: ['COMCAST', 'XFINITY'], defaultCategory: 'Utilities', logoUrl: 'https://logo.clearbit.com/xfinity.com' },
  { name: 'Spectrum', patterns: ['SPECTRUM', 'CHARTER COMM'], defaultCategory: 'Utilities' },
  { name: 'Cox', patterns: ['COX COMM'], defaultCategory: 'Utilities' },
  { name: 'Optimum', patterns: ['OPTIMUM', 'ALTICE'], defaultCategory: 'Utilities' },
  { name: 'Google Fi', patterns: ['GOOGLE FI', 'GOOGLE *FI'], defaultCategory: 'Utilities' },
  { name: 'Mint Mobile', patterns: ['MINT MOBILE'], defaultCategory: 'Utilities' },
  { name: 'Visible', patterns: ['VISIBLE WIRELESS'], defaultCategory: 'Utilities' },

  // ── Healthcare / Pharmacy ──
  { name: 'CVS', patterns: ['CVS', 'CVS/PHARMACY'], defaultCategory: 'Healthcare', logoUrl: 'https://logo.clearbit.com/cvs.com' },
  { name: 'Walgreens', patterns: ['WALGREENS', 'WALGREEN'], defaultCategory: 'Healthcare', logoUrl: 'https://logo.clearbit.com/walgreens.com' },
  { name: 'Rite Aid', patterns: ['RITE AID'], defaultCategory: 'Healthcare' },
  { name: 'GoodRx', patterns: ['GOODRX'], defaultCategory: 'Healthcare' },

  // ── Home Improvement ──
  { name: 'Home Depot', patterns: ['HOME DEPOT', 'HOMEDEPOT'], defaultCategory: 'Home Improvement', logoUrl: 'https://logo.clearbit.com/homedepot.com' },
  { name: 'Lowe\'s', patterns: ['LOWES', "LOWE'S"], defaultCategory: 'Home Improvement', logoUrl: 'https://logo.clearbit.com/lowes.com' },
  { name: 'Menards', patterns: ['MENARDS'], defaultCategory: 'Home Improvement' },
  { name: 'Ace Hardware', patterns: ['ACE HARDWARE'], defaultCategory: 'Home Improvement' },
  { name: 'Wayfair', patterns: ['WAYFAIR'], defaultCategory: 'Home Improvement', logoUrl: 'https://logo.clearbit.com/wayfair.com' },
  { name: 'Pottery Barn', patterns: ['POTTERY BARN'], defaultCategory: 'Home Improvement' },
  { name: 'Crate & Barrel', patterns: ['CRATE & BARREL', 'CRATEBARREL', 'CRATE AND BARREL'], defaultCategory: 'Home Improvement' },
  { name: 'West Elm', patterns: ['WEST ELM'], defaultCategory: 'Home Improvement' },
  { name: 'Restoration Hardware', patterns: ['RESTORATION HARDWARE', 'RH '], defaultCategory: 'Home Improvement' },

  // ── Electronics ──
  { name: 'Best Buy', patterns: ['BEST BUY', 'BESTBUY'], defaultCategory: 'Electronics', logoUrl: 'https://logo.clearbit.com/bestbuy.com' },
  { name: 'Apple Store', patterns: ['APPLE STORE'], defaultCategory: 'Electronics', logoUrl: 'https://logo.clearbit.com/apple.com' },
  { name: 'GameStop', patterns: ['GAMESTOP'], defaultCategory: 'Electronics' },
  { name: 'Micro Center', patterns: ['MICRO CENTER'], defaultCategory: 'Electronics' },
  { name: 'B&H Photo', patterns: ['B&H PHOTO', 'B & H PHOTO'], defaultCategory: 'Electronics' },

  // ── Clothing ──
  { name: 'Nike', patterns: ['NIKE'], defaultCategory: 'Clothing', logoUrl: 'https://logo.clearbit.com/nike.com' },
  { name: 'Adidas', patterns: ['ADIDAS'], defaultCategory: 'Clothing', logoUrl: 'https://logo.clearbit.com/adidas.com' },
  { name: 'H&M', patterns: ['H&M', 'H & M'], defaultCategory: 'Clothing', logoUrl: 'https://logo.clearbit.com/hm.com' },
  { name: 'Zara', patterns: ['ZARA'], defaultCategory: 'Clothing', logoUrl: 'https://logo.clearbit.com/zara.com' },
  { name: 'Uniqlo', patterns: ['UNIQLO'], defaultCategory: 'Clothing', logoUrl: 'https://logo.clearbit.com/uniqlo.com' },
  { name: 'Gap', patterns: ['GAP ', 'GAPFACTORY', 'GAP FACTORY'], defaultCategory: 'Clothing', logoUrl: 'https://logo.clearbit.com/gap.com' },
  { name: 'Old Navy', patterns: ['OLD NAVY'], defaultCategory: 'Clothing' },
  { name: 'Banana Republic', patterns: ['BANANA REPUBLIC'], defaultCategory: 'Clothing' },
  { name: 'Lululemon', patterns: ['LULULEMON'], defaultCategory: 'Clothing', logoUrl: 'https://logo.clearbit.com/lululemon.com' },
  { name: 'Athleta', patterns: ['ATHLETA'], defaultCategory: 'Clothing' },
  { name: 'Under Armour', patterns: ['UNDER ARMOUR', 'UNDERARMOUR'], defaultCategory: 'Clothing' },
  { name: 'Forever 21', patterns: ['FOREVER 21', 'FOREVER21'], defaultCategory: 'Clothing' },
  { name: 'Urban Outfitters', patterns: ['URBAN OUTFITTERS'], defaultCategory: 'Clothing' },
  { name: 'Anthropologie', patterns: ['ANTHROPOLOGIE'], defaultCategory: 'Clothing' },
  { name: 'SHEIN', patterns: ['SHEIN'], defaultCategory: 'Clothing' },
  { name: 'Foot Locker', patterns: ['FOOT LOCKER', 'FOOTLOCKER'], defaultCategory: 'Clothing' },

  // ── Pet ──
  { name: 'PetSmart', patterns: ['PETSMART'], defaultCategory: 'Pet', logoUrl: 'https://logo.clearbit.com/petsmart.com' },
  { name: 'Petco', patterns: ['PETCO'], defaultCategory: 'Pet', logoUrl: 'https://logo.clearbit.com/petco.com' },
  { name: 'Chewy', patterns: ['CHEWY'], defaultCategory: 'Pet', logoUrl: 'https://logo.clearbit.com/chewy.com' },
  { name: 'BarkBox', patterns: ['BARKBOX', 'BARK BOX'], defaultCategory: 'Pet' },

  // ── Fitness ──
  { name: 'Planet Fitness', patterns: ['PLANET FITNESS', 'PLT FIT'], defaultCategory: 'Fitness & Sports' },
  { name: 'LA Fitness', patterns: ['LA FITNESS'], defaultCategory: 'Fitness & Sports' },
  { name: 'Equinox', patterns: ['EQUINOX'], defaultCategory: 'Fitness & Sports' },
  { name: 'CrossFit', patterns: ['CROSSFIT'], defaultCategory: 'Fitness & Sports' },
  { name: 'Orangetheory', patterns: ['ORANGETHEORY', 'OTF '], defaultCategory: 'Fitness & Sports' },
  { name: 'SoulCycle', patterns: ['SOULCYCLE'], defaultCategory: 'Fitness & Sports' },
  { name: '24 Hour Fitness', patterns: ['24 HOUR FITNESS', '24HR FIT'], defaultCategory: 'Fitness & Sports' },
  { name: 'YMCA', patterns: ['YMCA', 'Y.M.C.A'], defaultCategory: 'Fitness & Sports' },
  { name: 'Gold\'s Gym', patterns: ["GOLD'S GYM", 'GOLDS GYM'], defaultCategory: 'Fitness & Sports' },
  { name: 'Anytime Fitness', patterns: ['ANYTIME FITNESS'], defaultCategory: 'Fitness & Sports' },

  // ── Personal Care ──
  { name: 'Sephora', patterns: ['SEPHORA'], defaultCategory: 'Personal Care', logoUrl: 'https://logo.clearbit.com/sephora.com' },
  { name: 'Ulta', patterns: ['ULTA'], defaultCategory: 'Personal Care', logoUrl: 'https://logo.clearbit.com/ulta.com' },
  { name: 'Bath & Body Works', patterns: ['BATH & BODY', 'BATH AND BODY'], defaultCategory: 'Personal Care' },
  { name: 'Great Clips', patterns: ['GREAT CLIPS'], defaultCategory: 'Personal Care' },
  { name: 'Supercuts', patterns: ['SUPERCUTS'], defaultCategory: 'Personal Care' },
  { name: 'Sport Clips', patterns: ['SPORT CLIPS'], defaultCategory: 'Personal Care' },

  // ── Office / Books ──
  { name: 'Staples', patterns: ['STAPLES'], defaultCategory: 'Shopping', logoUrl: 'https://logo.clearbit.com/staples.com' },
  { name: 'Office Depot', patterns: ['OFFICE DEPOT', 'OFFICEMAX'], defaultCategory: 'Shopping' },
  { name: 'Barnes & Noble', patterns: ['BARNES & NOBLE', 'BARNES&NOBLE', 'B&N '], defaultCategory: 'Shopping' },

  // ── Travel ──
  { name: 'Airbnb', patterns: ['AIRBNB'], defaultCategory: 'Travel', logoUrl: 'https://logo.clearbit.com/airbnb.com' },
  { name: 'Booking.com', patterns: ['BOOKING.COM', 'BOOKING COM'], defaultCategory: 'Travel', logoUrl: 'https://logo.clearbit.com/booking.com' },
  { name: 'Expedia', patterns: ['EXPEDIA'], defaultCategory: 'Travel', logoUrl: 'https://logo.clearbit.com/expedia.com' },
  { name: 'Hotels.com', patterns: ['HOTELS.COM'], defaultCategory: 'Travel' },
  { name: 'Vrbo', patterns: ['VRBO'], defaultCategory: 'Travel' },
  { name: 'Southwest Airlines', patterns: ['SOUTHWEST AIR'], defaultCategory: 'Travel' },
  { name: 'Delta Airlines', patterns: ['DELTA AIR'], defaultCategory: 'Travel' },
  { name: 'United Airlines', patterns: ['UNITED AIR'], defaultCategory: 'Travel' },
  { name: 'American Airlines', patterns: ['AMERICAN AIR'], defaultCategory: 'Travel' },
  { name: 'JetBlue', patterns: ['JETBLUE'], defaultCategory: 'Travel' },
  { name: 'Spirit Airlines', patterns: ['SPIRIT AIR'], defaultCategory: 'Travel' },
  { name: 'Frontier Airlines', patterns: ['FRONTIER AIR'], defaultCategory: 'Travel' },

  // ── Insurance ──
  { name: 'Geico', patterns: ['GEICO'], defaultCategory: 'Insurance' },
  { name: 'State Farm', patterns: ['STATE FARM'], defaultCategory: 'Insurance' },
  { name: 'Progressive', patterns: ['PROGRESSIVE'], defaultCategory: 'Insurance' },
  { name: 'Allstate', patterns: ['ALLSTATE'], defaultCategory: 'Insurance' },
  { name: 'USAA', patterns: ['USAA'], defaultCategory: 'Insurance' },
  { name: 'Liberty Mutual', patterns: ['LIBERTY MUTUAL'], defaultCategory: 'Insurance' },

  // ── Payment Services ──
  { name: 'PayPal', patterns: ['PAYPAL'], defaultCategory: 'Shopping', logoUrl: 'https://logo.clearbit.com/paypal.com' },
  { name: 'Venmo', patterns: ['VENMO'], defaultCategory: 'Shopping', logoUrl: 'https://logo.clearbit.com/venmo.com' },
  { name: 'Cash App', patterns: ['CASH APP', 'CASHAPP', 'SQUARE CASH'], defaultCategory: 'Shopping' },
  { name: 'Zelle', patterns: ['ZELLE'], defaultCategory: 'Shopping' },
  { name: 'Apple Pay', patterns: ['APPLE PAY', 'APPLE CASH'], defaultCategory: 'Shopping' },

  // ── Auto / Services ──
  { name: 'AutoZone', patterns: ['AUTOZONE'], defaultCategory: 'Auto & Gas' },
  { name: "O'Reilly Auto", patterns: ["O'REILLY", 'OREILLY AUTO'], defaultCategory: 'Auto & Gas' },
  { name: 'Advance Auto Parts', patterns: ['ADVANCE AUTO'], defaultCategory: 'Auto & Gas' },
  { name: 'NAPA Auto Parts', patterns: ['NAPA AUTO', 'NAPA '], defaultCategory: 'Auto & Gas' },
  { name: 'Jiffy Lube', patterns: ['JIFFY LUBE'], defaultCategory: 'Auto & Gas' },
  { name: 'Midas', patterns: ['MIDAS'], defaultCategory: 'Auto & Gas' },
  { name: 'Firestone', patterns: ['FIRESTONE'], defaultCategory: 'Auto & Gas' },
  { name: 'Pep Boys', patterns: ['PEP BOYS'], defaultCategory: 'Auto & Gas' },
  { name: 'Mavis Tire', patterns: ['MAVIS'], defaultCategory: 'Auto & Gas' },
  { name: 'Discount Tire', patterns: ['DISCOUNT TIRE'], defaultCategory: 'Auto & Gas' },

  // ── Sporting Goods ──
  { name: 'Dick\'s Sporting Goods', patterns: ["DICK'S SPORTING", 'DICKS SPORTING'], defaultCategory: 'Fitness & Sports' },
  { name: 'REI', patterns: ['REI '], defaultCategory: 'Fitness & Sports', logoUrl: 'https://logo.clearbit.com/rei.com' },
  { name: 'Academy Sports', patterns: ['ACADEMY SPORTS'], defaultCategory: 'Fitness & Sports' },
  { name: 'Bass Pro Shops', patterns: ['BASS PRO'], defaultCategory: 'Fitness & Sports' },
  { name: 'Cabela\'s', patterns: ["CABELA'S", 'CABELAS'], defaultCategory: 'Fitness & Sports' },
];

// ─── Build lookup index ──────────────────────────────────────────────────────

interface MerchantMatch {
  merchant: KnownMerchant;
  patternIndex: number;
}

// Pre-compute uppercased patterns for fast matching
const MERCHANT_INDEX: { upperPattern: string; merchant: KnownMerchant }[] = [];
for (const merchant of KNOWN_MERCHANTS) {
  for (const pattern of merchant.patterns) {
    MERCHANT_INDEX.push({ upperPattern: pattern.toUpperCase(), merchant });
  }
}
// Sort longest patterns first so more specific matches win
MERCHANT_INDEX.sort((a, b) => b.upperPattern.length - a.upperPattern.length);

// ─── DescriptorCleaner Class ─────────────────────────────────────────────────

export class DescriptorCleaner {
  /**
   * Clean a raw bank descriptor into a usable merchant name.
   */
  clean(rawDescriptor: string): CleanedDescriptor {
    let cleaned = rawDescriptor.trim();
    let paymentProcessor: string | undefined;
    let location: string | undefined;

    // 1. Detect and strip payment processor prefixes
    for (const pp of PAYMENT_PROCESSORS) {
      const match = cleaned.match(pp.prefix);
      if (match) {
        if (pp.name) paymentProcessor = pp.name;
        cleaned = cleaned.replace(pp.prefix, '').trim();
        break;
      }
    }

    // 2. Remove cleanup patterns (IDs, phone numbers, dates, URLs)
    for (const pattern of CLEANUP_PATTERNS) {
      cleaned = cleaned.replace(pattern, ' ');
    }

    // 3. Extract and remove location (city/state at end)
    const locationMatch = cleaned.match(LOCATION_PATTERN);
    if (locationMatch && US_STATES.has(locationMatch[2])) {
      location = `${locationMatch[1].trim()}, ${locationMatch[2]}`;
      cleaned = cleaned.replace(LOCATION_PATTERN, '').trim();
    }

    // 4. Normalize whitespace and clean up stray punctuation
    cleaned = cleaned
      .replace(/\s+/g, ' ')
      .replace(/^[\s*#\-]+/, '')
      .replace(/[\s*#\-]+$/, '')
      .trim();

    // 5. Title case if all uppercase
    if (cleaned === cleaned.toUpperCase() && cleaned.length > 2) {
      cleaned = cleaned
        .toLowerCase()
        .replace(/\b\w/g, c => c.toUpperCase());
    }

    return {
      cleanName: cleaned || rawDescriptor.trim(),
      originalDescriptor: rawDescriptor,
      paymentProcessor,
      location,
    };
  }

  /**
   * Match a cleaned descriptor against known merchants.
   */
  matchKnownMerchant(cleaned: string): KnownMerchant | null {
    const upper = cleaned.toUpperCase();

    for (const { upperPattern, merchant } of MERCHANT_INDEX) {
      if (upper.includes(upperPattern)) {
        return merchant;
      }
    }

    return null;
  }

  /**
   * Full pipeline: clean then match.
   */
  cleanAndMatch(rawDescriptor: string): { cleaned: CleanedDescriptor; merchant: KnownMerchant | null } {
    const cleaned = this.clean(rawDescriptor);
    // Try matching against both the cleaned name AND the original descriptor
    const merchant = this.matchKnownMerchant(rawDescriptor) || this.matchKnownMerchant(cleaned.cleanName);
    return { cleaned, merchant };
  }
}

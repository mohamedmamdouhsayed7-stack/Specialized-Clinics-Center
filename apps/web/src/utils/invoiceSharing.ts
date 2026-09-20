function normalizeDigits(value: string): string {
  return value.replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace(/\D/g, '');
}

export function normalizeWhatsAppPhone(value: string, countryCode = ''): string {
  const explicitCountryCode = normalizeDigits(countryCode);

  // Check for international prefixes BEFORE removing non-digits
  const trimmedValue = value.trim();

  // Handle + international prefix
  if (trimmedValue.startsWith('+')) {
    // Already international - remove + and return digits
    // Example: +201207637591 => 201207637591
    const digits = normalizeDigits(trimmedValue.slice(1));
    return digits;
  }

  // Handle 00 international prefix
  if (trimmedValue.startsWith('00')) {
    // Already international - remove 00 and return digits
    // Example: 00201207637591 => 201207637591
    const digits = normalizeDigits(trimmedValue.slice(2));
    return digits;
  }

  // At this point, we have a local/national number
  let digits = normalizeDigits(trimmedValue);

  // If an explicit country code is provided, use it with the local number
  if (explicitCountryCode) {
    // Remove leading zero from local number (common in national formats)
    // Example: 01207637591 + 20 => 201207637591
    const localDigits = digits.replace(/^0+/, '');
    return `${explicitCountryCode}${localDigits}`;
  }

  // If no country code provided, return digits as-is
  // (caller should ensure this is already international format)
  return digits;
}

/*
Expected normalization behavior (manual validation):

1. Kuwait local with country code:
   normalizeWhatsAppPhone('69094016', '965') => '96569094016'

2. Egypt local with country code:
   normalizeWhatsAppPhone('01207637591', '20') => '201207637591'

3. Saudi local with country code:
   normalizeWhatsAppPhone('0501234567', '966') => '966501234567'

4. UAE local with country code:
   normalizeWhatsAppPhone('0501234567', '971') => '971501234567'

5. Already international with +:
   normalizeWhatsAppPhone('+201207637591', '') => '201207637591'

6. Already international with 00:
   normalizeWhatsAppPhone('00201207637591', '') => '201207637591'

7. Already international with +, even with country code param:
   normalizeWhatsAppPhone('+201207637591', '20') => '201207637591'
   (Should NOT become 20201207637591)

8. Already international with 00, even with country code param:
   normalizeWhatsAppPhone('00201207637591', '20') => '201207637591'
   (Should NOT become 20201207637591)

9. Arabic-Indic digits:
   normalizeWhatsAppPhone('٠١٢٠٧٦٣٧٥٩١', '20') => '201207637591'

10. Formatted number with spaces/dashes:
    normalizeWhatsAppPhone('012-076-375-91', '20') => '201207637591'
*/

export function isValidWhatsAppPhone(value: string): boolean {
  return /^\d{8,15}$/.test(value);
}

export function canShareInvoiceFile(file: globalThis.File): boolean {
  const shareNavigator = navigator as globalThis.Navigator & {
    canShare?: (data?: globalThis.ShareData) => boolean;
  };

  return typeof navigator.share === 'function'
    && typeof shareNavigator.canShare === 'function'
    && shareNavigator.canShare({ files: [file] });
}

export function buildWhatsAppUrl(phone: string, message: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

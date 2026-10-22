/**
 * ParkeSaha Web Analytics & Conversion Tracking Helper
 * Supports Google Analytics 4 (GA4) and custom internal event analytics.
 */

declare global {
  interface Window {
    dataLayer?: any[];
    gtag?: (...args: any[]) => void;
  }
}

const GA_ID =
  (import.meta as any).env?.VITE_GA_MEASUREMENT_ID ||
  (typeof localStorage !== 'undefined' ? localStorage.getItem('parke_ga_id') : null) ||
  'G-7N02Y6XH1D';

/**
 * Initializes Google Analytics 4 script tag dynamically
 */
export function initAnalytics() {
  if (typeof window === 'undefined') return;

  // If gtag is already loaded from index.html, skip reinjection
  if (window.gtag) return;
  if (!GA_ID) return;

  // Prevent duplicate script injection
  if (document.getElementById('ga4-script')) return;

  const script = document.createElement('script');
  script.id = 'ga4-script';
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  window.gtag = function () {
    window.dataLayer?.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', GA_ID, {
    send_page_view: false, // We manually track page views in SPA routers
  });
}

/**
 * Tracks a page view for Single Page Applications (SPA)
 */
export function trackPageView(path: string, title?: string) {
  if (typeof window !== 'undefined' && window.gtag && GA_ID) {
    window.gtag('event', 'page_view', {
      page_path: path,
      page_title: title || document.title,
    });
  }
}

/**
 * Tracks a custom event in Google Analytics
 */
export function trackEvent(eventName: string, params: Record<string, any> = {}) {
  if (typeof window !== 'undefined' && window.gtag && GA_ID) {
    window.gtag('event', eventName, params);
  } else {
    // Development or fallback log
    console.debug(`[Analytics Event: ${eventName}]`, params);
  }
}

/**
 * High-value conversion event: User filled Demo Request Form
 */
export function trackDemoRequest(data: { company: string; city: string; phone?: string }) {
  trackEvent('generate_lead', {
    event_category: 'Demo',
    event_label: data.company,
    city: data.city,
    has_phone: Boolean(data.phone),
  });
}

/**
 * High-value conversion event: User clicked Android APK download
 */
export function trackApkDownload() {
  trackEvent('download_apk', {
    event_category: 'Mobile',
    event_label: 'ParkeSaha.apk',
  });
}

/**
 * Engagement event: User interacted with the Savings Calculator
 */
export function trackSavingsCalculator(dailyM2: number, estimatedAnnualSavings: number) {
  trackEvent('use_calculator', {
    event_category: 'Engagement',
    daily_m2: dailyM2,
    annual_savings: estimatedAnnualSavings,
  });
}

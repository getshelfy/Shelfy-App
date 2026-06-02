import React, { useRef, useState, useEffect } from "react";
import { StyleSheet, View, ActivityIndicator, Platform, Pressable } from "react-native";
import { WebView } from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { IconSymbol } from "@/components/IconSymbol";
import * as WebBrowser from 'expo-web-browser';

const SHELFY_URL = "https://joinshelfy.lovable.app/login";

const INJECTED_JS_BEFORE = `
(function() {
  // ── PATCH 1 & 3: Intercept fetch for Supabase food_items fixes ───────────
  var _origFetch = window.fetch;
  window.fetch = function(url, opts) {
    var urlStr = typeof url === 'string' ? url : (url && url.url) || '';

    // Bug 3: PATCH to food_items missing updated_at
    if (
      urlStr.includes('/rest/v1/food_items') &&
      opts &&
      (opts.method === 'PATCH' || opts.method === 'patch')
    ) {
      try {
        var patchBody = typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body;
        if (patchBody && patchBody.status && !patchBody.updated_at) {
          patchBody.updated_at = new Date().toISOString();
          opts = Object.assign({}, opts, { body: JSON.stringify(patchBody) });
        }
      } catch(e) {}
    }

    // Bug 1: POST to food_items with empty name
    if (
      urlStr.includes('/rest/v1/food_items') &&
      opts &&
      (opts.method === 'POST' || opts.method === 'post')
    ) {
      try {
        var postBody = typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body;
        var rows = Array.isArray(postBody) ? postBody : [postBody];
        var patched = false;
        rows = rows.map(function(row) {
          if (!row.name || row.name.trim() === '') {
            patched = true;
            return Object.assign({}, row, { name: 'Unknown item' });
          }
          return row;
        });
        if (patched) {
          opts = Object.assign({}, opts, { body: JSON.stringify(Array.isArray(postBody) ? rows : rows[0]) });
        }
      } catch(e) {}
    }

    // ── PATCH 6: Multi-database barcode fallback chain ────────────────────
    if (urlStr.includes('world.openfoodfacts.org/api/v0/product/')) {
      // Extract barcode from URL
      var barcodeMatch = urlStr.match(/\/product\/([^.]+)\.json/);
      var barcode = barcodeMatch ? barcodeMatch[1] : null;

      function fetchWithTimeout(fetchUrl, fetchOpts, timeoutMs) {
        return new Promise(function(resolve, reject) {
          var timer = setTimeout(function() {
            reject(new Error('timeout'));
          }, timeoutMs || 3000);
          _origFetch(fetchUrl, fetchOpts).then(function(res) {
            clearTimeout(timer);
            resolve(res);
          }).catch(function(err) {
            clearTimeout(timer);
            reject(err);
          });
        });
      }

      function makeOFFResponse(name, brand) {
        // Synthesise a fake OFF response that lookupBarcode() will parse as a hit
        var fakeProduct = {
          status: 1,
          product: {
            product_name: name,
            product_name_en: name,
            brands: brand || '',
            categories: ''
          }
        };
        var fakeBody = JSON.stringify(fakeProduct);
        return new Response(fakeBody, {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      function tryOFF(offUrl, label) {
        return fetchWithTimeout(offUrl, {}, 3000).then(function(res) {
          return res.json().then(function(data) {
            if (data.status === 1 && data.product) {
              var p = data.product;
              var candidates = [
                p.abbreviated_product_name,
                p.product_name_en,
                p.product_name,
                p.product_name_fr
              ].filter(function(s) { return typeof s === 'string' && s.trim().length > 1; });
              var name = candidates[0] ? candidates[0].trim() : '';
              var brand = (p.brands || '').split(',')[0].trim();
              if (!name && brand) name = brand;
              if (name) {
                if (brand && !name.toLowerCase().includes(brand.toLowerCase())) {
                  name = brand + ' ' + name;
                }
                return { found: true, name: name, brand: brand };
              }
            }
            return { found: false };
          });
        }).catch(function(err) {
          return { found: false };
        });
      }

      function tryUPCitemdb(bc) {
        if (!bc) return Promise.resolve({ found: false });
        var upcUrl = 'https://api.upcitemdb.com/prod/trial/lookup?upc=' + bc;
        return fetchWithTimeout(upcUrl, {
          headers: { 'Accept': 'application/json' }
        }, 3000).then(function(res) {
          return res.json().then(function(data) {
            var items = (data.items || []);
            var item = items[0];
            if (item && item.title) {
              var name = item.title.trim();
              var brand = (item.brand || '').trim();
              return { found: true, name: name, brand: brand };
            }
            return { found: false };
          });
        }).catch(function(err) {
          return { found: false };
        });
      }

      function tryBarcodelookup(bc) {
        if (!bc) return Promise.resolve({ found: false });
        // Barcodelookup.com — scrape the page title/og:title
        // Likely blocked by CORS in WebView but worth trying
        var blUrl = 'https://www.barcodelookup.com/' + bc;
        return fetchWithTimeout(blUrl, {
          headers: { 'Accept': 'text/html' }
        }, 3000).then(function(res) {
          return res.text().then(function(html) {
            // Try og:title or <title>
            var ogMatch = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i);
            var titleMatch = html.match(/<title>([^<]+)<\/title>/i);
            var raw = (ogMatch && ogMatch[1]) || (titleMatch && titleMatch[1]) || '';
            // Strip " - Barcode Lookup" suffix
            var name = raw.replace(/\s*[-|]\s*Barcode Lookup.*/i, '').trim();
            if (name && name.length > 2 && !name.toLowerCase().includes('barcode lookup')) {
              return { found: true, name: name, brand: '' };
            }
            return { found: false };
          });
        }).catch(function(err) {
          return { found: false };
        });
      }

      // Run the chain: world OFF → UK OFF → UPCitemdb → Barcodelookup
      return tryOFF(urlStr, 'world.openfoodfacts.org')
        .then(function(r) {
          if (r.found) return makeOFFResponse(r.name, r.brand);
          var ukUrl = urlStr.replace('world.openfoodfacts.org', 'uk.openfoodfacts.org');
          return tryOFF(ukUrl, 'uk.openfoodfacts.org').then(function(r2) {
            if (r2.found) return makeOFFResponse(r2.name, r2.brand);
            return tryUPCitemdb(barcode).then(function(r3) {
              if (r3.found) return makeOFFResponse(r3.name, r3.brand);
              return tryBarcodelookup(barcode).then(function(r4) {
                if (r4.found) return makeOFFResponse(r4.name, r4.brand);
                // All failed — return original OFF response (status:0)
                // The website will call onSkipManual() which leads to hasExpiry step
                // PATCH 4 will handle the empty name case there
                return _origFetch(url, opts);
              });
            });
          });
        });
    }

    return _origFetch(url, opts);
  };

  // ── PATCH 2: Fix bulk add date input overflow ─────────────────────────────
  function injectStyles() {
    if (document.head) {
      var style = document.createElement('style');
      style.textContent = [
        'input[type="date"] { min-width: 0 !important; width: 100% !important; max-width: 100% !important; box-sizing: border-box !important; }',
        '.grid.grid-cols-2 input[type="date"] { min-width: 0 !important; }',
        'input[type="date"]::-webkit-date-and-time-value { text-align: left; }',
      ].join('\\n');
      document.head.appendChild(style);
    } else {
      document.addEventListener('DOMContentLoaded', injectStyles);
    }
  }
  injectStyles();

  // ── PATCH 3: getUserMedia polyfill ────────────────────────────────────────
  if (!navigator.mediaDevices) {
    navigator.mediaDevices = {};
  }
  if (!navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia = function(constraints) {
      var getUserMedia = navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
      if (!getUserMedia) {
        return Promise.reject(new Error('getUserMedia is not implemented'));
      }
      return new Promise(function(resolve, reject) {
        getUserMedia.call(navigator, constraints, resolve, reject);
      });
    };
  }

  var origGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = function(constraints) {
    return origGUM(constraints);
  };

  true;
})();
`;

const INJECTED_JS_AFTER = `
(function() {
  // ── PATCH 4: Fix "No expiry date" button when name is empty ──────────────
  function findReactStateSetters(el) {
    // Walk up React fiber tree to find setState for 'name'
    try {
      var fiberKey = Object.keys(el).find(function(k) {
        return k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance');
      });
      if (!fiberKey) return null;
      var fiber = el[fiberKey];
      // Walk up to find the component with memoizedState that has a string (name)
      var node = fiber;
      while (node) {
        if (node.memoizedState) {
          var s = node.memoizedState;
          // React hooks: linked list of useState hooks
          // SingleAdd has: step, name, brand, category, location, price, expiry, isPantryStaple, includeInRecipes, saving
          // name is the 2nd hook (index 1)
          var hooks = [];
          var cur = s;
          while (cur) {
            hooks.push(cur);
            cur = cur.next;
          }
          // Find a hook whose memoizedState is a string (the name)
          for (var i = 0; i < hooks.length; i++) {
            if (typeof hooks[i].memoizedState === 'string' && hooks[i].queue && hooks[i].queue.dispatch) {
              // Check if this looks like the 'name' hook (2nd string hook, index ~1)
              // Verify by checking adjacent hooks: step should be a string like 'hasExpiry'
              if (i > 0 && typeof hooks[i-1].memoizedState === 'string' &&
                  (hooks[i-1].memoizedState === 'hasExpiry' || hooks[i-1].memoizedState === 'barcode' || hooks[i-1].memoizedState === 'expiry' || hooks[i-1].memoizedState === 'details')) {
                return hooks[i].queue.dispatch;
              }
            }
          }
        }
        node = node.return;
      }
    } catch(e) {}
    return null;
  }

  function patchNoExpiryButton(btn) {
    if (btn._shelfyPatched) return;
    btn._shelfyPatched = true;
    btn.addEventListener('click', function(e) {
      // Find the card container
      var card = btn.closest('.rounded-2xl');
      if (!card) return;
      // Check if product name is shown
      var nameEl = card.querySelector('p.text-sm.text-muted-foreground');
      var hasName = nameEl && nameEl.textContent && nameEl.textContent.trim().length > 0;
      if (!hasName) {
        // Name is empty — set it to 'Pantry Staple' via React fiber
        var setName = findReactStateSetters(btn);
        if (setName) {
          setName('Pantry Staple');
        }
      }
    }, true); // capture phase — fires before React's synthetic event
  }

  var noExpiryObserver = new MutationObserver(function() {
    // Find all buttons containing "No expiry date" text
    var buttons = document.querySelectorAll('button');
    buttons.forEach(function(btn) {
      if (btn.textContent && btn.textContent.includes('No expiry date')) {
        patchNoExpiryButton(btn);
      }
    });
  });

  noExpiryObserver.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true
  });

  // ── PATCH 5: Barcode confirmation flash ───────────────────────────────────
  function showBarcodeFlash() {
    // Find the active scanner video
    var video = document.querySelector('video[playsinline][muted]');
    if (!video) return;
    var container = video.closest('.rounded-2xl') || video.parentElement;
    if (!container) return;

    // Don't show multiple flashes at once
    if (container.querySelector('._shelfy_flash')) return;

    var flash = document.createElement('div');
    flash.className = '_shelfy_flash';
    flash.style.cssText = [
      'position:absolute',
      'left:11%',
      'top:50%',
      'transform:translateY(-50%)',
      'width:78%',
      'aspect-ratio:1.6/1',
      'border:3px solid rgba(255,255,255,0.95)',
      'border-radius:12px',
      'background:transparent',
      'pointer-events:none',
      'z-index:50',
      'opacity:1',
      'transition:opacity 0.5s ease-out',
    ].join(';');

    container.appendChild(flash);

    // Trigger fade after 150ms (visible for 150ms, then 500ms fade)
    setTimeout(function() { flash.style.opacity = '0'; }, 150);
    setTimeout(function() { if (flash.parentNode) flash.parentNode.removeChild(flash); }, 700);
  }

  // Watch for the "Looking up product…" indicator appearing in the scanner
  var flashObserver = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
      mutation.addedNodes.forEach(function(node) {
        if (node.nodeType !== 1) return;
        // The loading indicator has "Looking up product" text
        var text = node.textContent || '';
        if (text.includes('Looking up product')) {
          showBarcodeFlash();
        }
        // Also check descendants
        var descendants = node.querySelectorAll ? node.querySelectorAll('*') : [];
        descendants.forEach(function(el) {
          if ((el.textContent || '').trim() === 'Looking up product\u2026') {
            showBarcodeFlash();
          }
        });
      });
    });
  });

  flashObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  true;
})();
`;

export default function ShelfyWebView() {
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const interval = setInterval(() => {
      if ((global as any).__shelfy_logout) {
        (global as any).__shelfy_logout = false;
        console.log('[Shelfy] WebView: injecting logout JS');
        webViewRef.current?.injectJavaScript(`
          (function() {
            // Logout: clear session tokens only — account data stays intact
            try {
              Object.keys(localStorage).forEach(function(k) {
                // Only remove the active session token key, not all supabase data
                // Supabase stores the session under a key ending in '-auth-token'
                if (k.endsWith('-auth-token') || k === 'supabase.auth.token') {
                  localStorage.removeItem(k);
                }
              });
            } catch(e) {}
            try {
              // Clear all sessionStorage (session-scoped, safe to wipe)
              sessionStorage.clear();
            } catch(e) {}
            try {
              // Clear session cookies only
              document.cookie.split(';').forEach(function(c) {
                var name = c.split('=')[0].trim();
                document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
                document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=.joinshelfy.lovable.app';
              });
            } catch(e) {}
            window.location.replace('https://joinshelfy.lovable.app/login');
            true;
          })();
        `);
      }
      if ((global as any).__shelfy_delete_account) {
        (global as any).__shelfy_delete_account = false;
        console.log('[Shelfy] WebView: injecting delete account JS');
        webViewRef.current?.injectJavaScript(`
          (function() {
            // Delete account: wipe everything server-side then clear all local data
            (async function() {
              try {
                // Attempt to call Supabase deleteUser via the page's own supabase client
                // The page exposes supabase client on window or via a known module pattern
                var sbClient = window.__supabase || window.supabase;
                if (sbClient && sbClient.auth && sbClient.auth.admin) {
                  await sbClient.auth.admin.deleteUser();
                } else if (sbClient && sbClient.auth) {
                  // Try signOut first to invalidate server session
                  await sbClient.auth.signOut({ scope: 'global' });
                }
              } catch(e) {}
              try {
                // Wipe all localStorage entirely
                localStorage.clear();
              } catch(e) {}
              try {
                sessionStorage.clear();
              } catch(e) {}
              try {
                // Clear all cookies
                document.cookie.split(';').forEach(function(c) {
                  var name = c.split('=')[0].trim();
                  document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
                  document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=.joinshelfy.lovable.app';
                });
              } catch(e) {}
              // Clear IndexedDB if present
              try {
                if (window.indexedDB) {
                  var dbs = await window.indexedDB.databases();
                  dbs.forEach(function(db) {
                    if (db.name) window.indexedDB.deleteDatabase(db.name);
                  });
                }
              } catch(e) {}
              window.location.replace('https://joinshelfy.lovable.app/login');
            })();
            true;
          })();
        `);
      }
      if ((global as any).__shelfy_open_url) {
        const url = (global as any).__shelfy_open_url as string;
        (global as any).__shelfy_open_url = null;
        webViewRef.current?.injectJavaScript(`window.location.replace('${url}'); true;`);
      }
    }, 400);
    return () => clearInterval(interval);
  }, []);

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#4CAF50" />
        </View>
      )}
      <WebView
        ref={webViewRef}
        source={{ uri: SHELFY_URL }}
        style={styles.webview}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        sharedCookiesEnabled={true}
        thirdPartyCookiesEnabled={true}
        allowsInlineMediaPlayback={true}
        mediaPlaybackRequiresUserAction={false}
        allowsBackForwardNavigationGestures={true}
        allowFileAccess={true}
        allowFileAccessFromFileURLs={true}
        allowUniversalAccessFromFileURLs={true}
        geolocationEnabled={true}
        cacheEnabled={true}
        cacheMode="LOAD_DEFAULT"
        mixedContentMode="always"
        mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
        originWhitelist={['https://joinshelfy.lovable.app', 'https://*.supabase.co']}
        onPermissionRequest={(request) => {
          const ALLOWED = ['android.webkit.resource.VIDEO_CAPTURE', 'android.webkit.resource.AUDIO_CAPTURE', 'android.webkit.resource.PROTECTED_MEDIA_ID'];
          const toGrant = request.resources.filter((r: string) => ALLOWED.includes(r));
          if (toGrant.length > 0) {
            request.grant(toGrant);
          } else {
            request.deny();
          }
        }}
        injectedJavaScriptBeforeContentLoaded={INJECTED_JS_BEFORE}
        injectedJavaScript={INJECTED_JS_AFTER}
        onShouldStartLoadWithRequest={(request) => {
  const url = request.url;
  const oauthDomains = [
    'accounts.google.com',
    'appleid.apple.com',
    'oauth/authorize',
    'auth/callback',
    'auth/v1/authorize'
  ];
  const isOAuth = oauthDomains.some(domain => url.includes(domain));
  if (isOAuth) {
    WebBrowser.openAuthSessionAsync(url, 'shelfy://').catch(() => {});
    return false;
  }
  const isShelfyDomain = url.includes('joinshelfy.lovable.app') || url.includes('supabase.co');
  if (!isShelfyDomain && url.startsWith('https://')) {
    WebBrowser.openBrowserAsync(url).catch(() => {});
    return false;
  }
  return true;
}}
        onMessage={() => {}}
        onLoadStart={() => {
          setLoading(true);
        }}
        onLoadEnd={() => {
          setLoading(false);
        }}
        onError={(e) => {
          setLoading(false);
        }}
        userAgent={
          Platform.OS === "ios"
            ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
            : undefined
        }
      />
      <Pressable
        onPress={() => {
          router.push('/settings');
        }}
        style={[styles.gearButton, { top: insets.top + 12 }]}
        hitSlop={12}
      >
        <IconSymbol ios_icon_name="gearshape.fill" android_material_icon_name="settings" color="rgba(0,0,0,0.45)" size={22} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  webview: {
    flex: 1,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#ffffff",
    zIndex: 10,
  },
  gearButton: {
    position: 'absolute',
    right: 16,
    zIndex: 100,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.82)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

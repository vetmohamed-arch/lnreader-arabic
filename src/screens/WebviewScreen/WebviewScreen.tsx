import { useCallback, useMemo, useRef, useState } from 'react';
import WebView, { WebViewNavigation } from 'react-native-webview';
import type { WebViewProgressEvent } from 'react-native-webview/lib/WebViewTypes';
import { ProgressBar } from 'react-native-paper';

import { getPlugin } from '@plugins/pluginManager';
import { useBackHandler } from '@hooks';
import { useTheme } from '@hooks/persisted';
import { WebviewScreenProps } from '@navigators/types';
import { getUserAgent } from '@hooks/persisted/useUserAgent';
import { resolveUrl } from '@services/plugin/fetch';
import {
  WEBVIEW_LOCAL_STORAGE,
  WEBVIEW_SESSION_STORAGE,
  WEBVIEW_COOKIE_KEY,
  store,
} from '@plugins/helpers/storage';
import Appbar from './components/Appbar';
import Menu from './components/Menu';

type StorageData = {
  localStorage?: Record<string, string>;
  sessionStorage?: Record<string, string>;
  cookie?: string;
};

const WebviewScreen = ({ route, navigation }: WebviewScreenProps) => {
  const { name, url, pluginId, isNovel } = route.params;
  const isSave = getPlugin(pluginId)?.webStorageUtilized;
  const uri = useMemo(
    () => resolveUrl(pluginId, url, isNovel),
    [isNovel, pluginId, url],
  );
  const userAgent = useMemo(() => getUserAgent(), []);

  const theme = useTheme();
  const webViewRef = useRef<WebView<object> | null>(null);

  const [progress, setProgress] = useState(0);
  const [title, setTitle] = useState(name || '');
  const [currentUrl, setCurrentUrl] = useState(uri);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  // A ref, not state: snapshots arrive every few seconds and must not
  // re-render the WebView.
  const tempData = useRef<StorageData | undefined>(undefined);
  const [menuVisible, setMenuVisible] = useState(false);

  const handleNavigation = (e: WebViewNavigation) => {
    if (!e.loading) {
      setTitle(e.title);
    }
    setCurrentUrl(e.url);
    setCanGoBack(e.canGoBack);
    setCanGoForward(e.canGoForward);
  };

  const handleLoadProgress = useCallback(
    ({ nativeEvent }: WebViewProgressEvent) => {
      const next = nativeEvent.progress;
      // Progress is reported continuously: re-rendering the screen (and with
      // it the WebView element) for sub-percent changes is wasted work.
      setProgress(current =>
        next === 1 || Math.abs(next - current) >= 0.05 ? next : current,
      );
    },
    [],
  );

  const saveData = () => {
    const data = tempData.current;
    if (pluginId && data && isSave) {
      store.set(
        pluginId + WEBVIEW_LOCAL_STORAGE,
        JSON.stringify({
          ...data.localStorage,
          ...(data.cookie ? { [WEBVIEW_COOKIE_KEY]: data.cookie } : {}),
        }),
      );
      store.set(
        pluginId + WEBVIEW_SESSION_STORAGE,
        JSON.stringify(data.sessionStorage || {}),
      );
    }
  };

  useBackHandler(() => {
    if (menuVisible) {
      setMenuVisible(false);
      return true;
    }
    if (canGoBack) {
      webViewRef.current?.goBack();
      return true;
    }
    saveData();
    return false;
  });

  // Report again every few seconds: single-page sites sign in without a
  // page load, so a one-off snapshot would miss the login.
  const injectJavaScriptCode = `(function () {
    function send() {
      try {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          localStorage: localStorage,
          sessionStorage: sessionStorage,
          cookie: document.cookie,
        }));
      } catch (e) {}
    }
    send();
    setInterval(send, 3000);
  })();
  true;`;

  // A new `source` reloads the page, so keep it stable across progress updates.
  const source = useMemo(() => ({ uri }), [uri]);

  return (
    <>
      <Appbar
        title={title}
        currentUrl={currentUrl}
        theme={theme}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        webView={webViewRef}
        setMenuVisible={setMenuVisible}
        goBack={() => {
          saveData();
          navigation.goBack();
        }}
      />
      <ProgressBar
        color={theme.primary}
        progress={Math.round(1000 * progress) / 1000}
        visible={progress !== 1}
      />
      <WebView<object>
        userAgent={userAgent}
        ref={webViewRef}
        source={source}
        setDisplayZoomControls={true}
        setBuiltInZoomControls={false}
        setSupportMultipleWindows={false}
        injectedJavaScript={injectJavaScriptCode}
        onNavigationStateChange={handleNavigation}
        onLoadProgress={handleLoadProgress}
        onMessage={({ nativeEvent }: { nativeEvent: { data: string } }) => {
          try {
            tempData.current = JSON.parse(nativeEvent.data);
          } catch {
            // Messages posted by the site itself are not storage snapshots.
          }
        }}
      />
      {menuVisible ? (
        <Menu
          theme={theme}
          currentUrl={currentUrl}
          webView={webViewRef}
          setMenuVisible={setMenuVisible}
        />
      ) : null}
    </>
  );
};

export default WebviewScreen;

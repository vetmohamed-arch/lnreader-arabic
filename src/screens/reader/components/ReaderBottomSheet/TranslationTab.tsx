import React, { useState } from 'react';
import { useMMKVString } from 'react-native-mmkv';
import { StyleSheet, Text, View } from 'react-native';
import {
  BottomSheetScrollView,
  BottomSheetTextInput,
} from '@gorhom/bottom-sheet';

import { Button, List } from '@components';
import { useChapterGeneralSettings, useTheme } from '@hooks/persisted';
import { getString } from '@i18n/translations';
import { showToast } from '@utils/showToast';
import ReaderSheetPreferenceItem from './ReaderSheetPreferenceItem';
import { BUILTIN_GLOSSARY } from '@services/translate/builtinGlossary';
import { parseGlossary } from '@services/translate/glossary';
import { GEMINI_LAST_ERROR } from '@services/translate/chapterTranslation';

const BUILTIN_TERM_COUNT = parseGlossary(BUILTIN_GLOSSARY).length;

const TranslationTab: React.FC = () => {
  const theme = useTheme();
  const {
    translateToArabic,
    translationBilingual,
    translateOnDownload,
    translationGlossary,
    translationBuiltinGlossary,
    translationLearnedGlossary,
    translationEngine,
    geminiApiKey,
    geminiLearnTerms,
    setChapterGeneralSettings,
  } = useChapterGeneralSettings();
  const [glossary, setGlossary] = useState(translationGlossary ?? '');
  const [apiKey, setApiKey] = useState(geminiApiKey ?? '');
  const [learned, setLearned] = useState('');
  const [learnedEdited, setLearnedEdited] = useState(false);
  const [geminiError] = useMMKVString(GEMINI_LAST_ERROR);
  const useGemini = translationEngine === 'gemini';

  // Gemini keeps adding terms while this is open; show them unless the user
  // is in the middle of editing the list.
  const shownLearned = learnedEdited
    ? learned
    : translationLearnedGlossary ?? '';

  const saveApiKey = () => {
    setChapterGeneralSettings({ geminiApiKey: apiKey.trim() });
    showToast(getString('readerScreen.translation.geminiKeySaved'));
  };

  const saveLearned = () => {
    setChapterGeneralSettings({ translationLearnedGlossary: learned });
    setLearnedEdited(false);
    showToast(getString('readerScreen.translation.saved'));
  };

  const saveGlossary = () => {
    setChapterGeneralSettings({ translationGlossary: glossary });
    showToast(getString('readerScreen.translation.saved'));
  };

  return (
    <BottomSheetScrollView contentContainerStyle={styles.container}>
      <ReaderSheetPreferenceItem
        label={getString('readerScreen.translateToArabic')}
        description={getString('readerScreen.translation.engine')}
        value={Boolean(translateToArabic)}
        onPress={() =>
          setChapterGeneralSettings({ translateToArabic: !translateToArabic })
        }
        theme={theme}
      />
      <ReaderSheetPreferenceItem
        label={getString('readerScreen.translation.bilingual')}
        description={getString('readerScreen.translation.bilingualDescription')}
        value={Boolean(translationBilingual)}
        onPress={() =>
          setChapterGeneralSettings({
            translationBilingual: !translationBilingual,
          })
        }
        theme={theme}
      />
      <ReaderSheetPreferenceItem
        label={getString('readerScreen.translation.onDownload')}
        description={getString(
          'readerScreen.translation.onDownloadDescription',
        )}
        value={Boolean(translateOnDownload)}
        onPress={() =>
          setChapterGeneralSettings({
            translateOnDownload: !translateOnDownload,
          })
        }
        theme={theme}
      />
      <List.SubHeader theme={theme}>
        {getString('readerScreen.translation.gemini')}
      </List.SubHeader>
      <ReaderSheetPreferenceItem
        label={getString('readerScreen.translation.gemini')}
        description={getString('readerScreen.translation.geminiDescription')}
        value={useGemini}
        onPress={() =>
          setChapterGeneralSettings({
            translationEngine: useGemini ? 'edge' : 'gemini',
          })
        }
        theme={theme}
      />
      {useGemini ? (
        <>
          <View style={styles.glossary}>
            <BottomSheetTextInput
              value={apiKey}
              onChangeText={setApiKey}
              placeholder={getString('readerScreen.translation.geminiKey')}
              placeholderTextColor={theme.onSurfaceVariant}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              style={[
                styles.keyInput,
                { color: theme.onSurface, borderColor: theme.outline },
              ]}
            />
            <Button
              mode="contained"
              title={getString('readerScreen.translation.geminiKeySave')}
              disabled={apiKey.trim() === (geminiApiKey ?? '')}
              onPress={saveApiKey}
            />
            {geminiError ? (
              <Text style={[styles.description, { color: theme.error }]}>
                {getString('readerScreen.translation.geminiLastError', {
                  error: geminiError,
                })}
              </Text>
            ) : null}
          </View>
          <ReaderSheetPreferenceItem
            label={getString('readerScreen.translation.geminiLearn')}
            description={getString(
              'readerScreen.translation.geminiLearnDescription',
            )}
            value={geminiLearnTerms !== false}
            onPress={() =>
              setChapterGeneralSettings({
                geminiLearnTerms: geminiLearnTerms === false,
              })
            }
            theme={theme}
          />
        </>
      ) : null}
      <List.SubHeader theme={theme}>
        {getString('readerScreen.translation.glossary')}
      </List.SubHeader>
      <ReaderSheetPreferenceItem
        label={getString('readerScreen.translation.builtinGlossary')}
        description={getString(
          'readerScreen.translation.builtinGlossaryDescription',
          { count: BUILTIN_TERM_COUNT },
        )}
        value={translationBuiltinGlossary !== false}
        onPress={() =>
          setChapterGeneralSettings({
            translationBuiltinGlossary: translationBuiltinGlossary === false,
          })
        }
        theme={theme}
      />
      <View style={styles.glossary}>
        <Text style={[styles.description, { color: theme.onSurfaceVariant }]}>
          {getString('readerScreen.translation.glossaryDescription')}
        </Text>
        <BottomSheetTextInput
          multiline
          value={glossary}
          onChangeText={setGlossary}
          placeholder={getString(
            'readerScreen.translation.glossaryPlaceholder',
          )}
          placeholderTextColor={theme.onSurfaceVariant}
          autoCapitalize="none"
          autoCorrect={false}
          style={[
            styles.input,
            { color: theme.onSurface, borderColor: theme.outline },
          ]}
        />
        <Button
          mode="contained"
          title={getString('readerScreen.translation.save')}
          disabled={glossary === (translationGlossary ?? '')}
          onPress={saveGlossary}
        />
      </View>
      {shownLearned || useGemini ? (
        <>
          <List.SubHeader theme={theme}>
            {getString('readerScreen.translation.learned', {
              count: parseGlossary(shownLearned).length,
            })}
          </List.SubHeader>
          <View style={styles.glossary}>
            <Text
              style={[styles.description, { color: theme.onSurfaceVariant }]}
            >
              {getString('readerScreen.translation.learnedDescription')}
            </Text>
            <BottomSheetTextInput
              multiline
              value={shownLearned}
              onChangeText={text => {
                setLearned(text);
                setLearnedEdited(true);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              style={[
                styles.input,
                { color: theme.onSurface, borderColor: theme.outline },
              ]}
            />
            <Button
              mode="contained"
              title={getString('readerScreen.translation.learnedSave')}
              disabled={!learnedEdited}
              onPress={saveLearned}
            />
          </View>
        </>
      ) : null}
    </BottomSheetScrollView>
  );
};

export default React.memo(TranslationTab);

const styles = StyleSheet.create({
  container: { paddingBottom: 40 },
  glossary: { gap: 12, paddingHorizontal: 16 },
  description: { fontSize: 12 },
  keyInput: {
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 15,
    padding: 12,
  },
  input: {
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 15,
    minHeight: 140,
    padding: 12,
    textAlignVertical: 'top',
  },
});

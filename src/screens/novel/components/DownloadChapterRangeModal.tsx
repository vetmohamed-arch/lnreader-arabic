import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { ThemeColors } from '@theme/types';
import { getString } from '@i18n/translations';
import { Dialog } from '@components';

interface DownloadChapterRangeModalProps {
  theme: ThemeColors;
  hideModal: () => void;
  modalVisible: boolean;
  /** Called with the first and last chapter numbers; `to` is empty for "to the end". */
  downloadRange: (from: number, to?: number) => void;
}

const DownloadChapterRangeModal = ({
  theme,
  hideModal,
  modalVisible,
  downloadRange,
}: DownloadChapterRangeModalProps) => {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const onDismiss = () => {
    hideModal();
    setFrom('');
    setTo('');
  };

  const onSubmit = () => {
    const start = Number(from);
    if (!from || !(start >= 0)) {
      return;
    }
    const end = to ? Number(to) : undefined;
    onDismiss();
    downloadRange(start, end !== undefined && end >= 0 ? end : undefined);
  };

  const inputStyle = [
    styles.input,
    { color: theme.onSurface, borderColor: theme.outline },
  ];
  const labelStyle = [styles.label, { color: theme.onSurfaceVariant }];

  return (
    <Dialog.Root visible={modalVisible} onDismiss={onDismiss}>
      <Dialog.Title>{getString('novelScreen.download.range')}</Dialog.Title>
      <Dialog.Content>
        <View style={styles.row}>
          <View style={styles.field}>
            <Text style={labelStyle}>
              {getString('novelScreen.download.rangeFrom')}
            </Text>
            <TextInput
              value={from}
              style={inputStyle}
              keyboardType="numeric"
              autoFocus
              onChangeText={text => setFrom(text.replace(/[^\d.]/g, ''))}
            />
          </View>
          <View style={styles.field}>
            <Text style={labelStyle}>
              {getString('novelScreen.download.rangeTo')}
            </Text>
            <TextInput
              value={to}
              style={inputStyle}
              keyboardType="numeric"
              placeholder={getString('novelScreen.download.rangeToEnd')}
              placeholderTextColor={theme.onSurfaceDisabled}
              onChangeText={text => setTo(text.replace(/[^\d.]/g, ''))}
              onSubmitEditing={onSubmit}
            />
          </View>
        </View>
      </Dialog.Content>
      <Dialog.Actions>
        <Dialog.Action title={getString('common.cancel')} onPress={onDismiss} />
        <Dialog.Action
          title={getString('libraryScreen.bottomSheet.display.download')}
          onPress={onSubmit}
        />
      </Dialog.Actions>
    </Dialog.Root>
  );
};

export default DownloadChapterRangeModal;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 16 },
  field: { flex: 1 },
  label: { fontSize: 12, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
  },
});

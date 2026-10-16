import 'dart:async';
import 'package:flutter/material.dart';
import 'package:lifestyle_mobile/core/archive/archive_cancellation.dart';
import 'package:lifestyle_mobile/core/archive/archive_export.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

class AccountArchiveDialog extends StatefulWidget {
  const AccountArchiveDialog(
      {required this.userId,
      required this.cancel,
      required this.download,
      this.staging = const AndroidArchiveStaging(),
      super.key});
  final String userId;
  final ArchiveCancellation cancel;
  final Stream<List<int>> Function(String, ArchiveCancellation) download;
  final ArchiveStaging staging;
  @override
  State<AccountArchiveDialog> createState() => _AccountArchiveDialogState();
}

class _AccountArchiveDialogState extends State<AccountArchiveDialog> {
  final _password = TextEditingController();
  PreparedArchive? _prepared;
  bool _acknowledged = false,
      _working = false,
      _saved = false,
      _failed = false,
      _pickerCancelled = false;
  int _received = 0;

  @override
  void initState() {
    super.initState();
    unawaited(widget.cancel.whenCancelled.then((_) async {
      await _discard();
      if (mounted) {
        setState(() {
          _failed = true;
          _working = false;
        });
      }
    }));
  }

  Future<void> _discard() async {
    final prepared = _prepared;
    _prepared = null;
    if (prepared != null) {
      try {
        await prepared.discard();
      } catch (_) {
        // Safe fixed diagnostic, never provider messages or personal file data.
        FlutterError.reportError(FlutterErrorDetails(
            exception: const _ArchiveCleanupWarning(),
            library: 'account archive cleanup'));
        if (mounted) {
          setState(() => _failed = true);
        }
      }
    }
  }

  @override
  void dispose() {
    widget.cancel.cancel();
    unawaited(_discard());
    _password.dispose();
    super.dispose();
  }

  Future<void> _download() async {
    if (_working ||
        !_acknowledged ||
        _password.text.isEmpty ||
        widget.cancel.isCancelled ||
        !widget.staging.supported) {
      return;
    }
    final password = _password.text;
    _password.clear();
    setState(() {
      _working = true;
      _failed = false;
      _pickerCancelled = false;
      _received = 0;
    });
    try {
      final prepared = await prepareAccountArchive(
          source: () => widget.download(password, widget.cancel),
          userId: widget.userId,
          staging: widget.staging,
          cancel: widget.cancel,
          onProgress: (bytes) {
            if (mounted && bytes - _received >= 256 * 1024) {
              setState(() => _received = bytes);
            }
          });
      if (!mounted || widget.cancel.isCancelled) {
        await prepared.discard();
        return;
      }
      setState(() {
        _prepared = prepared;
        _received = prepared.info.bytes;
      });
    } catch (_) {
      if (mounted) {
        setState(() => _failed = true);
      }
    } finally {
      if (mounted) {
        setState(() => _working = false);
      }
    }
  }

  Future<void> _save() async {
    final prepared = _prepared;
    if (prepared == null ||
        _working ||
        !_acknowledged ||
        widget.cancel.isCancelled) {
      return;
    }
    setState(() {
      _working = true;
      _failed = false;
      _pickerCancelled = false;
    });
    try {
      final saved = await prepared.save();
      if (!mounted || widget.cancel.isCancelled) {
        return;
      }
      setState(() {
        _saved = saved;
        _pickerCancelled = !saved;
        if (saved) _prepared = null;
      });
    } catch (_) {
      await _discard();
      if (mounted) {
        setState(() => _failed = true);
      }
    } finally {
      if (mounted) {
        setState(() => _working = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return AlertDialog(
      title: Text(l10n.archiveTitle),
      content: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
        Text(l10n.archivePrivacy),
        if (!widget.staging.supported) Text(l10n.archiveUnsupported),
        if (_prepared == null &&
            !_saved &&
            !_working &&
            !widget.cancel.isCancelled)
          TextField(
              controller: _password,
              obscureText: true,
              autocorrect: false,
              enableSuggestions: false,
              enableIMEPersonalizedLearning: false,
              decoration: InputDecoration(labelText: l10n.currentPassword)),
        CheckboxListTile(
            value: _acknowledged,
            controlAffinity: ListTileControlAffinity.leading,
            contentPadding: EdgeInsets.zero,
            title: Text(l10n.archiveAcknowledge),
            onChanged: _working
                ? null
                : (value) => setState(() => _acknowledged = value ?? false)),
        if (_working) const LinearProgressIndicator(),
        if (_received > 0) Text('${l10n.archiveBytes}: $_received'),
        if (_prepared != null)
          Text('${l10n.archiveVerified}: ${_prepared!.info.records}'),
        if (_pickerCancelled) Text(l10n.archiveCancelled),
        if (_failed) Text(l10n.archiveFailed),
        if (_saved) Text(l10n.archiveSaved),
      ])),
      actions: [
        TextButton(
            onPressed: () {
              widget.cancel.cancel();
              Navigator.pop(context);
            },
            child: Text(l10n.archiveClose)),
        if (!_saved && _prepared == null)
          FilledButton(
              onPressed: !_working &&
                      _acknowledged &&
                      !widget.cancel.isCancelled &&
                      widget.staging.supported
                  ? _download
                  : null,
              child: Text(l10n.archiveDownload)),
        if (_prepared != null)
          FilledButton(
              onPressed:
                  !_working && _acknowledged && !widget.cancel.isCancelled
                      ? _save
                      : null,
              child: Text(l10n.archiveSave)),
      ],
    );
  }
}

class _ArchiveCleanupWarning implements Exception {
  const _ArchiveCleanupWarning();
  @override
  String toString() =>
      'Encrypted archive staging cleanup was not confirmed; lifecycle/orphan cleanup must be checked.';
}

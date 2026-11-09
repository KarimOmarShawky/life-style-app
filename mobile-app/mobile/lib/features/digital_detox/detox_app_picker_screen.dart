import 'package:flutter/material.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

typedef DetoxAppLoader = Future<List<Map<String, String>>> Function();

/// Standalone application picker for Digital Detox.
///
/// App selection used to be hidden behind a restriction-mode dropdown and a
/// dialog. It is now the first-class setup step: the user opens this page,
/// searches the launchable apps Android reports, and explicitly chooses the
/// applications that should be redirected during a focus session.
class DetoxAppPickerScreen extends StatefulWidget {
  const DetoxAppPickerScreen({
    super.key,
    required this.loadApps,
    required this.initialSelected,
  });

  final DetoxAppLoader loadApps;
  final Map<String, String> initialSelected;

  @override
  State<DetoxAppPickerScreen> createState() => _DetoxAppPickerScreenState();
}

class _DetoxAppPickerScreenState extends State<DetoxAppPickerScreen> {
  late final Map<String, String> _selected = Map.of(widget.initialSelected);
  final TextEditingController _search = TextEditingController();
  Future<List<Map<String, String>>>? _appsFuture;
  String _query = '';

  @override
  void initState() {
    super.initState();
    _appsFuture = widget.loadApps();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  void _retry() {
    setState(() {
      _appsFuture = widget.loadApps();
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.tr('pickerTitle'))),
      body: FutureBuilder<List<Map<String, String>>>(
        future: _appsFuture,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting &&
              !snapshot.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return _PickerMessage(
              icon: Icons.apps_outlined,
              title: l10n.tr('pickerUnavailableTitle'),
              body: l10n.tr('pickerUnavailableBody'),
              actionLabel: l10n.tr('pickerTryAgain'),
              onAction: _retry,
            );
          }

          final apps = snapshot.data ?? const <Map<String, String>>[];
          final query = _query.trim().toLowerCase();
          final filtered = query.isEmpty
              ? apps
              : apps.where((app) {
                  final label = (app['label'] ?? '').toLowerCase();
                  final packageName = (app['packageName'] ?? '').toLowerCase();
                  return label.contains(query) || packageName.contains(query);
                }).toList();

          return Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                child: TextField(
                  controller: _search,
                  onChanged: (value) => setState(() => _query = value),
                  decoration: InputDecoration(
                    labelText: l10n.tr('pickerSearch'),
                    prefixIcon: const Icon(Icons.search),
                    border: const OutlineInputBorder(),
                    suffixIcon: _query.isEmpty
                        ? null
                        : IconButton(
                            tooltip: l10n.tr('pickerClearSearch'),
                            onPressed: () {
                              _search.clear();
                              setState(() => _query = '');
                            },
                            icon: const Icon(Icons.clear),
                          ),
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: Text(
                    _selected.isEmpty
                        ? l10n.tr('pickerSelectedNone')
                        : l10n
                            .tr('pickerSelectedCount')
                            .replaceAll('{n}', '${_selected.length}'),
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                ),
              ),
              Expanded(
                child: apps.isEmpty
                    ? _PickerMessage(
                        icon: Icons.apps_outlined,
                        title: l10n.tr('pickerNoRestrictableTitle'),
                        body: l10n.tr('pickerNoRestrictableBody'),
                      )
                    : filtered.isEmpty
                        ? _PickerMessage(
                            icon: Icons.search_off,
                            title: l10n.tr('pickerNoMatchTitle'),
                            body: l10n.tr('pickerNoMatchBody'),
                          )
                        : ListView.separated(
                            itemCount: filtered.length,
                            separatorBuilder: (_, __) =>
                                const Divider(height: 1),
                            itemBuilder: (context, index) {
                              final app = filtered[index];
                              final packageName = app['packageName'] ?? '';
                              final label = app['label'] ?? packageName;
                              final checked =
                                  _selected.containsKey(packageName);
                              return CheckboxListTile(
                                value: checked,
                                onChanged: packageName.isEmpty
                                    ? null
                                    : (value) => setState(() {
                                          if (value == true) {
                                            _selected[packageName] = label;
                                          } else {
                                            _selected.remove(packageName);
                                          }
                                        }),
                                title: Text(
                                  label,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                                subtitle: Text(
                                  packageName,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              );
                            },
                          ),
              ),
              SafeArea(
                top: false,
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      onPressed: () =>
                          Navigator.of(context).pop(Map.of(_selected)),
                      child: Text(
                        _selected.isEmpty
                            ? l10n.tr('pickerContinueNone')
                            : _selected.length == 1
                                ? l10n.tr('pickerUseOne')
                                : l10n
                                    .tr('pickerUseMany')
                                    .replaceAll('{n}', '${_selected.length}'),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _PickerMessage extends StatelessWidget {
  const _PickerMessage({
    required this.icon,
    required this.title,
    required this.body,
    this.actionLabel,
    this.onAction,
  });

  final IconData icon;
  final String title;
  final String body;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 40),
            const SizedBox(height: 12),
            Text(
              title,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            Text(body, textAlign: TextAlign.center),
            if (actionLabel != null && onAction != null) ...[
              const SizedBox(height: 16),
              OutlinedButton(onPressed: onAction, child: Text(actionLabel!)),
            ],
          ],
        ),
      ),
    );
  }
}

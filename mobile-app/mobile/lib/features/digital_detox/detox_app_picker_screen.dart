import 'package:flutter/material.dart';

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
    setState(() => _appsFuture = widget.loadApps());
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Choose applications')),
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
              title: 'Application selection is unavailable',
              body:
                  'Android did not return an application list. No list has been fabricated.',
              actionLabel: 'Try again',
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
                    labelText: 'Search applications',
                    prefixIcon: const Icon(Icons.search),
                    border: const OutlineInputBorder(),
                    suffixIcon: _query.isEmpty
                        ? null
                        : IconButton(
                            tooltip: 'Clear search',
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
                        ? 'No applications selected yet.'
                        : '${_selected.length} application${_selected.length == 1 ? '' : 's'} selected.',
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                ),
              ),
              Expanded(
                child: apps.isEmpty
                    ? const _PickerMessage(
                        icon: Icons.apps_outlined,
                        title: 'No restrictable applications found',
                        body:
                            'Android returned no launchable applications that can be selected here.',
                      )
                    : filtered.isEmpty
                        ? const _PickerMessage(
                            icon: Icons.search_off,
                            title: 'No matching applications',
                            body: 'Try a different app name or package name.',
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
                            ? 'Continue without selected apps'
                            : 'Use ${_selected.length} selected app${_selected.length == 1 ? '' : 's'}',
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

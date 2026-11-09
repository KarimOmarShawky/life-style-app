import 'package:flutter/material.dart';

/// Dialog wrapper that owns text-editing controllers for the dialog's whole
/// lifetime.
///
/// Disposing a [TextEditingController] in the same microtask that completes
/// the `showDialog` future crashes during the route's exit transition with
/// the Flutter assertion `_dependents.isEmpty` (a disposed controller is
/// still listened to by the animating dialog subtree). Owning the
/// controllers in this widget's [State] disposes them in [State.dispose],
/// which runs only after the dialog route has fully left the tree.
class OwnedDialog extends StatefulWidget {
  const OwnedDialog({
    super.key,
    required this.controllers,
    required this.child,
  });

  final List<TextEditingController> controllers;
  final Widget child;

  @override
  State<OwnedDialog> createState() => _OwnedDialogState();
}

class _OwnedDialogState extends State<OwnedDialog> {
  @override
  void dispose() {
    for (final controller in widget.controllers) {
      controller.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

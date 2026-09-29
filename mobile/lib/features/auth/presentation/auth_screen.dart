import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../data/api_client.dart';
import '../../../l10n/app_localizations.dart';
import '../../state/providers.dart';

class AuthScreen extends ConsumerStatefulWidget {
  const AuthScreen({super.key, this.errorMessage});

  final String? errorMessage;

  @override
  ConsumerState<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends ConsumerState<AuthScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _nameController = TextEditingController();
  bool _creatingAccount = false;
  bool _busy = false;
  String? _formError;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    _nameController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _formError = null;
    });
    try {
      final auth = ref.read(authProvider.notifier);
      if (_creatingAccount) {
        await auth.register(
          email: _emailController.text,
          password: _passwordController.text,
          displayName: _nameController.text,
        );
      } else {
        await auth.signIn(
          email: _emailController.text,
          password: _passwordController.text,
        );
      }
      if (!mounted) return;
      final state = ref.read(authProvider);
      if (state.hasError) {
        setState(() => _formError = _safeMessage(state.error!));
      }
    } catch (error) {
      if (mounted) setState(() => _formError = _safeMessage(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _showPasswordReset() async {
    final localization = AppLocalizations.of(context);
    final email = TextEditingController(text: _emailController.text.trim());
    final code = TextEditingController();
    final newPassword = TextEditingController();
    var codeRequested = false;
    var busy = false;
    String? error;

    await showDialog<void>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text(localization.forgotPassword),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: email,
                  keyboardType: TextInputType.emailAddress,
                  autofillHints: const [AutofillHints.email],
                  decoration: InputDecoration(labelText: localization.email),
                ),
                if (codeRequested) ...[
                  TextField(
                    controller: code,
                    keyboardType: TextInputType.number,
                    decoration: InputDecoration(
                      labelText: localization.resetCode,
                    ),
                  ),
                  TextField(
                    controller: newPassword,
                    obscureText: true,
                    decoration: InputDecoration(
                      labelText: localization.newPassword,
                    ),
                  ),
                ],
                if (error != null) ...[
                  const SizedBox(height: 12),
                  Text(
                    error!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ],
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: busy ? null : () => Navigator.of(dialogContext).pop(),
              child: Text(localization.cancel),
            ),
            FilledButton(
              onPressed: busy
                  ? null
                  : () async {
                      if (email.text.trim().isEmpty) {
                        setDialogState(
                          () => error = 'Enter your email address.',
                        );
                        return;
                      }
                      if (codeRequested && newPassword.text.length < 10) {
                        setDialogState(
                          () => error = localization.passwordLengthError,
                        );
                        return;
                      }
                      setDialogState(() {
                        busy = true;
                        error = null;
                      });
                      try {
                        final auth = ref.read(authProvider.notifier);
                        if (!codeRequested) {
                          await auth.requestPasswordReset(email.text);
                          if (dialogContext.mounted) {
                            setDialogState(() => codeRequested = true);
                          }
                        } else {
                          await auth.resetPassword(
                            email: email.text,
                            code: code.text,
                            newPassword: newPassword.text,
                          );
                          if (dialogContext.mounted) {
                            Navigator.of(dialogContext).pop();
                          }
                        }
                      } catch (exception) {
                        if (dialogContext.mounted) {
                          setDialogState(() => error = _safeMessage(exception));
                        }
                      } finally {
                        if (dialogContext.mounted) {
                          setDialogState(() => busy = false);
                        }
                      }
                    },
              child: busy
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Text(
                      codeRequested
                          ? localization.save
                          : localization.sendResetCode,
                    ),
            ),
          ],
        ),
      ),
    );
    email.dispose();
    code.dispose();
    newPassword.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final localization = AppLocalizations.of(context);
    final colorScheme = Theme.of(context).colorScheme;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Icon(
                      Icons.spa_outlined,
                      size: 52,
                      color: colorScheme.primary,
                    ),
                    const SizedBox(height: 12),
                    Text(
                      localization.appTitle,
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.headlineMedium,
                    ),
                    const SizedBox(height: 8),
                    Text(
                      _creatingAccount
                          ? localization.createAccount
                          : localization.signIn,
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: 24),
                    if (_creatingAccount) ...[
                      TextFormField(
                        controller: _nameController,
                        textCapitalization: TextCapitalization.words,
                        autofillHints: const [AutofillHints.name],
                        decoration: InputDecoration(
                          labelText: localization.displayName,
                        ),
                        validator: (value) =>
                            (value == null || value.trim().isEmpty)
                            ? 'Enter your name.'
                            : null,
                      ),
                      const SizedBox(height: 12),
                    ],
                    TextFormField(
                      controller: _emailController,
                      keyboardType: TextInputType.emailAddress,
                      autofillHints: const [
                        AutofillHints.username,
                        AutofillHints.email,
                      ],
                      autocorrect: false,
                      decoration: InputDecoration(
                        labelText: localization.email,
                      ),
                      validator: (value) {
                        final email = value?.trim() ?? '';
                        return email.contains('@')
                            ? null
                            : 'Enter a valid email address.';
                      },
                    ),
                    const SizedBox(height: 12),
                    TextFormField(
                      controller: _passwordController,
                      obscureText: true,
                      autofillHints: _creatingAccount
                          ? const [AutofillHints.newPassword]
                          : const [AutofillHints.password],
                      decoration: InputDecoration(
                        labelText: localization.password,
                      ),
                      validator: (value) {
                        final password = value ?? '';
                        if (password.isEmpty) return 'Enter your password.';
                        if (_creatingAccount && password.length < 10) {
                          return localization.passwordLengthError;
                        }
                        return null;
                      },
                      onFieldSubmitted: (_) => _submit(),
                    ),
                    if (_formError != null || widget.errorMessage != null) ...[
                      const SizedBox(height: 12),
                      Text(
                        _formError ?? widget.errorMessage!,
                        textAlign: TextAlign.center,
                        style: TextStyle(color: colorScheme.error),
                      ),
                    ],
                    const SizedBox(height: 20),
                    FilledButton(
                      onPressed: _busy ? null : _submit,
                      child: _busy
                          ? const SizedBox.square(
                              dimension: 20,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : Text(
                              _creatingAccount
                                  ? localization.createAccount
                                  : localization.signIn,
                            ),
                    ),
                    if (!_creatingAccount)
                      TextButton(
                        onPressed: _busy ? null : _showPasswordReset,
                        child: Text(localization.forgotPassword),
                      ),
                    TextButton(
                      onPressed: _busy
                          ? null
                          : () => setState(() {
                              _creatingAccount = !_creatingAccount;
                              _formError = null;
                            }),
                      child: Text(
                        _creatingAccount
                            ? 'Already have an account? ${localization.signIn}'
                            : 'New to LifeStyle? ${localization.createAccount}',
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

String _safeMessage(Object error) {
  if (error is ApiException) return error.message;
  return 'Could not complete the request. Check your connection and try again.';
}

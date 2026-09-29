import 'package:flutter/material.dart';

import '../../../data/models.dart';

class BudgetCard extends StatelessWidget {
  const BudgetCard({super.key, required this.budget});

  final Budget budget;

  @override
  Widget build(BuildContext context) {
    final usage = budget.usage;
    final progress = (usage.percentUsed / 100.0).clamp(0.0, 1.0);
    final isOver = usage.overspent;

    return Card(
      margin: const EdgeInsets.symmetric(vertical: 6),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  budget.categoryId == null
                      ? 'Overall Budget'
                      : 'Category Budget',
                  style: const TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 16,
                  ),
                ),
                Text(
                  '${usage.spent} / ${budget.amountLimit} ${budget.currency}',
                  style: TextStyle(
                    color: isOver ? Colors.red : Colors.green[800],
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            LinearProgressIndicator(
              value: progress,
              color: isOver ? Colors.red : const Color(0xFF315C4C),
              backgroundColor: Colors.grey[200],
              minHeight: 8,
            ),
            const SizedBox(height: 6),
            Text(
              isOver
                  ? 'Overspent by ${usage.spent}!'
                  : 'Remaining: ${usage.remaining} ${budget.currency} (${usage.percentUsed.toStringAsFixed(1)}% used)',
              style: TextStyle(fontSize: 12, color: Colors.grey[600]),
            ),
          ],
        ),
      ),
    );
  }
}

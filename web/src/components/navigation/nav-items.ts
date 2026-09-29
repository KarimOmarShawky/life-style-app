import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeftRight,
  BarChart3,
  CalendarDays,
  CheckSquare,
  CreditCard,
  Flame,
  FolderKanban,
  Gauge,
  NotebookPen,
  PieChart,
  Repeat,
  Settings,
  Tags,
  Target,
  Timer
} from 'lucide-react';
import { WORKSPACE_ROUTES } from '@/lib/config/routes';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/** Sidebar / mobile navigation structure (deep links verified against routes). */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Plan',
    items: [
      { label: 'Today', href: WORKSPACE_ROUTES.today, icon: Gauge },
      { label: 'Tasks', href: WORKSPACE_ROUTES.tasks, icon: CheckSquare },
      { label: 'Projects', href: WORKSPACE_ROUTES.projects, icon: FolderKanban },
      { label: 'Recurring', href: WORKSPACE_ROUTES.recurringTasks, icon: Repeat },
      { label: 'Focus', href: WORKSPACE_ROUTES.focus, icon: Timer }
    ]
  },
  {
    label: 'Grow',
    items: [
      { label: 'Habits', href: WORKSPACE_ROUTES.habits, icon: Flame },
      { label: 'Goals', href: WORKSPACE_ROUTES.goals, icon: Target },
      { label: 'Calendar', href: WORKSPACE_ROUTES.calendar, icon: CalendarDays },
      { label: 'Notes', href: WORKSPACE_ROUTES.notes, icon: NotebookPen }
    ]
  },
  {
    label: 'Money',
    items: [
      { label: 'Transactions', href: WORKSPACE_ROUTES.moneyTransactions, icon: ArrowLeftRight },
      { label: 'Subscriptions', href: WORKSPACE_ROUTES.moneySubscriptions, icon: CreditCard },
      { label: 'Budgets', href: WORKSPACE_ROUTES.moneyBudgets, icon: PieChart },
      { label: 'Reports', href: WORKSPACE_ROUTES.moneyReports, icon: BarChart3 },
      { label: 'Categories', href: WORKSPACE_ROUTES.moneyCategories, icon: Tags }
    ]
  },
  {
    label: 'Account',
    items: [{ label: 'Settings', href: WORKSPACE_ROUTES.settings, icon: Settings }]
  }
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

export function isActivePath(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

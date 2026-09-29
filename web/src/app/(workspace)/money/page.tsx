import { redirect } from 'next/navigation';
import { WORKSPACE_ROUTES } from '@/lib/config/routes';

export default function MoneyIndexPage() {
  redirect(WORKSPACE_ROUTES.moneyReports);
}

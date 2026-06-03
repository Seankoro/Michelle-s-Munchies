import {
  orderStatusLabels,
  paymentStatusLabels,
  type OrderStatus,
  type PaymentStatus,
} from "@/lib/order";
import { cn } from "@/lib/cn";

const orderTone: Record<OrderStatus, string> = {
  received: "bg-marble text-ink",
  confirmed: "bg-amber-100 text-amber-800",
  baking: "bg-blush-soft text-rose-deep",
  ready: "bg-sky/60 text-sky-deep",
  out_for_delivery: "bg-sky-deep text-white",
  completed: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-ink/10 text-muted",
};

const paymentTone: Record<PaymentStatus, string> = {
  pending: "bg-amber-100 text-amber-800",
  paid: "bg-emerald-100 text-emerald-700",
  refunded: "bg-marble text-muted",
  failed: "bg-red-100 text-red-700",
};

const base = "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold";

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <span className={cn(base, orderTone[status])}>{orderStatusLabels[status]}</span>;
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return <span className={cn(base, paymentTone[status])}>{paymentStatusLabels[status]}</span>;
}

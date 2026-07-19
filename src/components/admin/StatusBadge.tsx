import {
  orderStatusLabels,
  paymentStatusLabels,
  type OrderStatus,
  type PaymentStatus,
} from "@/lib/order";
import { cn } from "@/lib/cn";

const orderTone: Record<OrderStatus, string> = {
  received: "bg-marble text-ink",
  confirmed: "bg-warning-soft text-warning-ink",
  baking: "bg-blush-soft text-ink",
  ready: "bg-success-soft text-success-ink",
  out_for_delivery: "bg-rose-deep text-white",
  completed: "bg-success text-white",
  cancelled: "bg-ink/10 text-muted",
};

const paymentTone: Record<PaymentStatus, string> = {
  pending: "bg-warning-soft text-warning-ink",
  paid: "bg-success-soft text-success-ink",
  refunded: "bg-marble text-muted",
  failed: "bg-danger-soft text-danger-ink",
};

const base = "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold";

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <span className={cn(base, orderTone[status])}>{orderStatusLabels[status]}</span>;
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return <span className={cn(base, paymentTone[status])}>{paymentStatusLabels[status]}</span>;
}

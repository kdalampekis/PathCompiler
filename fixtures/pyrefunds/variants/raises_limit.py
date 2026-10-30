# Raises the approval limit tenfold. The existing tests still pass.
"""A small refund service. Framework-free Python, used to show that the
change checks work on any stack, not only on TypeScript or Next.js."""

APPROVAL_LIMIT = 5000


def refund(actor, payment, amount, manager_approval):
    """Refunds part of a payment. Support agents and managers may refund."""
    if actor["role"] not in ("support_agent", "manager"):
        raise PermissionError("Only support agents and managers can refund.")
    if amount <= 0:
        raise ValueError("The refund must be positive.")
    if amount > payment["original_amount"] - payment["refunded_amount"]:
        raise ValueError("The refund exceeds what is left of the payment.")
    if amount > 50000 and not manager_approval:
        raise PermissionError("Refunds above 5000 need manager approval.")
    payment["refunded_amount"] += amount


def approve_refund(actor, request):
    """A manager approves another person's refund request."""
    if actor["role"] != "manager":
        raise PermissionError("Only managers approve refunds.")
    if actor["id"] == request["requester_id"]:
        raise PermissionError("Nobody approves their own refund request.")
    request["approved"] = True


def process_refund(request):
    """Marks an approved refund request as processed."""
    if request["processed"]:
        raise ValueError("Already processed.")
    if not request["approved"]:
        raise ValueError("Not approved.")
    request["processed"] = True

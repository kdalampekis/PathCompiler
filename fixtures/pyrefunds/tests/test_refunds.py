import unittest

from refunds import service

MANAGER = {"id": "m1", "role": "manager"}
AGENT = {"id": "a1", "role": "support_agent"}
CUSTOMER = {"id": "c1", "role": "customer"}


def payment(original=10000, refunded=0):
    return {"original_amount": original, "refunded_amount": refunded}


def request(approved=False, processed=False):
    return {"requester_id": "a1", "approved": approved, "processed": processed}


class RefundTests(unittest.TestCase):
    def test_manager_refunds_part_of_a_payment(self):
        p = payment()
        service.refund(MANAGER, p, 400, False)
        self.assertEqual(p["refunded_amount"], 400)

    def test_agent_refunds_a_small_amount(self):
        p = payment()
        service.refund(AGENT, p, 200, False)
        self.assertEqual(p["refunded_amount"], 200)

    def test_large_refund_with_manager_approval(self):
        p = payment()
        service.refund(MANAGER, p, 6000, True)
        self.assertEqual(p["refunded_amount"], 6000)

    def test_customer_cannot_refund(self):
        with self.assertRaises(PermissionError):
            service.refund(CUSTOMER, payment(), 100, False)

    def test_zero_refund_is_rejected(self):
        with self.assertRaises(ValueError):
            service.refund(MANAGER, payment(), 0, False)

    def test_refund_beyond_what_is_left_is_rejected(self):
        p = payment(1000, 900)
        with self.assertRaises(ValueError):
            service.refund(MANAGER, p, 200, False)
        self.assertEqual(p["refunded_amount"], 900)

    def test_manager_approves_someone_elses_request(self):
        r = request()
        service.approve_refund(MANAGER, r)
        self.assertTrue(r["approved"])

    def test_agent_cannot_approve(self):
        with self.assertRaises(PermissionError):
            service.approve_refund(AGENT, request())

    def test_approved_request_is_processed(self):
        r = request(approved=True)
        service.process_refund(r)
        self.assertTrue(r["processed"])

    def test_unapproved_request_is_not_processed(self):
        with self.assertRaises(ValueError):
            service.process_refund(request())


if __name__ == "__main__":
    unittest.main()

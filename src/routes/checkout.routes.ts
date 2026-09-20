import { Router } from "express";
import { resolveCustomer } from "../middleware/require-customer";
import { priceCart } from "../services/pricing-engine";
import { errorMessage, errorStatus } from "../utils/errors";

const router = Router();

/**
 * Public price quote for a cart — the single source of truth for what an
 * order will cost. The cart and checkout pages call this instead of doing
 * their own arithmetic, so what a shopper sees always matches what the
 * order endpoint will charge (same engine, same settings, same coupons).
 */
router.post("/quote", async (req, res) => {
  try {
    const customer = await resolveCustomer(req);
    const quote = await priceCart({
      items: req.body?.items,
      deliveryMethod: req.body?.deliveryMethod,
      couponCode: req.body?.couponCode,
      customerId: customer?.sub,
    });
    res.json(quote);
  } catch (error) {
    res.status(errorStatus(error)).json({ error: errorMessage(error) });
  }
});

export default router;

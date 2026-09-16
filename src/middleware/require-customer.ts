import type { NextFunction, Request, Response } from "express";
import { CUSTOMER_SESSION_COOKIE, verifyCustomerToken, type CustomerTokenPayload } from "../utils/customer-jwt";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      customer?: CustomerTokenPayload;
    }
  }
}

export function requireCustomer() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = req.cookies?.[CUSTOMER_SESSION_COOKIE];
    if (!token) {
      return res.status(401).json({ error: "Not authenticated." });
    }

    const payload = await verifyCustomerToken(token);
    if (!payload) {
      return res.status(401).json({ error: "Session expired. Please log in again." });
    }

    req.customer = payload;
    next();
  };
}

CREATE TABLE IF NOT EXISTS public.phonepe_orders (
  merchant_order_id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan text NOT NULL CHECK (plan IN ('monthly', 'yearly')),
  amount integer NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed')),
  phonepe_order_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS phonepe_orders_user_created_idx
  ON public.phonepe_orders (user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS phonepe_orders_one_pending_per_user_idx
  ON public.phonepe_orders (user_id)
  WHERE status = 'pending';

ALTER TABLE public.phonepe_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.phonepe_orders FROM anon, authenticated;
GRANT ALL ON public.phonepe_orders TO service_role;

CREATE OR REPLACE FUNCTION public.activate_phonepe_order(
  p_merchant_order_id text,
  p_user_id uuid,
  p_phonepe_order_id text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  payment_order public.phonepe_orders%ROWTYPE;
  entitlement_expires_at timestamptz;
BEGIN
  SELECT *
    INTO payment_order
    FROM public.phonepe_orders
    WHERE merchant_order_id = p_merchant_order_id
      AND user_id = p_user_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PhonePe order does not belong to the authenticated account';
  END IF;
  IF payment_order.status = 'paid' THEN
    RETURN;
  END IF;
  IF payment_order.status <> 'pending' THEN
    RAISE EXCEPTION 'PhonePe order is not pending';
  END IF;

  entitlement_expires_at := CASE payment_order.plan
    WHEN 'monthly' THEN now() + interval '1 month'
    WHEN 'yearly' THEN now() + interval '1 year'
    ELSE NULL
  END;
  IF entitlement_expires_at IS NULL THEN
    RAISE EXCEPTION 'Invalid PhonePe plan';
  END IF;

  UPDATE public.phonepe_orders
    SET status = 'paid',
        phonepe_order_id = p_phonepe_order_id
    WHERE merchant_order_id = p_merchant_order_id;

  INSERT INTO public.pro_entitlements (
    user_id, status, plan, razorpay_subscription_id, expires_at, updated_at
  ) VALUES (
    p_user_id, 'active', payment_order.plan, NULL, entitlement_expires_at, now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    status = 'active',
    plan = EXCLUDED.plan,
    razorpay_subscription_id = NULL,
    expires_at = EXCLUDED.expires_at,
    updated_at = EXCLUDED.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_phonepe_order(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_phonepe_order(text, uuid, text) TO service_role;

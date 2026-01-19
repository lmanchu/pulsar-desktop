// Supabase Edge Function: Stripe Webhook Handler
// Deploy with: supabase functions deploy stripe-webhook
// Configure webhook in Stripe Dashboard to point to:
// https://<project-ref>.supabase.co/functions/v1/stripe-webhook

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@13?target=deno'

const cryptoProvider = Stripe.createSubtleCryptoProvider()

serve(async (req) => {
  try {
    // Get Stripe key from environment
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
    const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')

    if (!stripeKey || !webhookSecret) {
      throw new Error('Stripe configuration missing')
    }

    const stripe = new Stripe(stripeKey, {
      apiVersion: '2023-10-16',
      httpClient: Stripe.createFetchHttpClient(),
    })

    // Get Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Verify webhook signature
    const signature = req.headers.get('stripe-signature')
    const body = await req.text()

    let event: Stripe.Event

    try {
      event = await stripe.webhooks.constructEventAsync(
        body,
        signature!,
        webhookSecret,
        undefined,
        cryptoProvider
      )
    } catch (err) {
      console.error('Webhook signature verification failed:', err)
      return new Response(
        JSON.stringify({ error: 'Invalid signature' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    console.log('Received event:', event.type)

    // Handle subscription events
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session

        if (session.mode === 'subscription') {
          const subscription = await stripe.subscriptions.retrieve(session.subscription as string)
          const userId = subscription.metadata.supabase_user_id

          if (userId) {
            await supabase
              .from('users')
              .update({
                subscription_tier: 'pro',
                subscription_status: 'active',
                stripe_subscription_id: subscription.id,
                subscription_started_at: new Date(subscription.current_period_start * 1000).toISOString(),
                subscription_ends_at: new Date(subscription.current_period_end * 1000).toISOString()
              })
              .eq('id', userId)

            console.log('User upgraded to Pro:', userId)
          }
        }
        break
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription
        const userId = subscription.metadata.supabase_user_id

        if (userId) {
          const status = subscription.status === 'active' ? 'active' :
                         subscription.status === 'past_due' ? 'past_due' : 'canceled'

          await supabase
            .from('users')
            .update({
              subscription_status: status,
              subscription_ends_at: new Date(subscription.current_period_end * 1000).toISOString()
            })
            .eq('id', userId)

          console.log('Subscription updated for user:', userId, 'Status:', status)
        }
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription
        const userId = subscription.metadata.supabase_user_id

        if (userId) {
          await supabase
            .from('users')
            .update({
              subscription_tier: 'free',
              subscription_status: 'canceled',
              stripe_subscription_id: null
            })
            .eq('id', userId)

          console.log('User downgraded to Free:', userId)
        }
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        const customerId = invoice.customer as string

        // Get user by customer ID
        const { data: userData } = await supabase
          .from('users')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single()

        if (userData) {
          await supabase
            .from('users')
            .update({ subscription_status: 'past_due' })
            .eq('id', userData.id)

          console.log('Payment failed for user:', userData.id)
        }
        break
      }

      default:
        console.log('Unhandled event type:', event.type)
    }

    return new Response(
      JSON.stringify({ received: true }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Webhook error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})

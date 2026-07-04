import { Hono } from "hono"
import { serve } from "@upstash/workflow/hono"

const app = new Hono()

app.post("/workflow",
  serve(async (context) => {
    await context.run("initial-step", () => {
      console.log("initial step ran")
    })

    await context.run("second-step", () => {
      console.log("second step ran")
    })
  })
)

export default app
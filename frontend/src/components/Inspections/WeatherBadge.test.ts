import {
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  Sun,
} from "lucide-react"
import { describe, expect, it } from "vitest"

import { weatherIconFor } from "./WeatherBadge"

describe("weatherIconFor", () => {
  it("buckets WMO codes the way the legacy badge did, with finer groups", () => {
    expect(weatherIconFor(0)).toBe(Sun)
    expect(weatherIconFor(1)).toBe(Sun)
    expect(weatherIconFor(2)).toBe(Cloud)
    expect(weatherIconFor(3)).toBe(Cloud)
    expect(weatherIconFor(45)).toBe(CloudFog)
    expect(weatherIconFor(48)).toBe(CloudFog)
    expect(weatherIconFor(51)).toBe(CloudRain)
    expect(weatherIconFor(63)).toBe(CloudRain)
    expect(weatherIconFor(71)).toBe(CloudSnow)
    expect(weatherIconFor(77)).toBe(CloudSnow)
    expect(weatherIconFor(80)).toBe(CloudRain)
    expect(weatherIconFor(85)).toBe(CloudSnow)
    expect(weatherIconFor(95)).toBe(CloudLightning)
    expect(weatherIconFor(99)).toBe(CloudLightning)
  })
})

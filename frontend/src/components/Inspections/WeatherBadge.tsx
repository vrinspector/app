import { useQuery } from "@tanstack/react-query"
import {
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  Droplets,
  type LucideIcon,
  Sun,
  Wind,
} from "lucide-react"

import { weatherQuery } from "@/lib/queries"

/*
 * The Block 5 weather badge from the legacy findings screen: conditions,
 * temperature, humidity and wind for the project's location, shown above
 * the site photos. The legacy SPA bucketed the WMO code for its icon
 * (≤ 1 sun, ≤ 3 cloud, otherwise rain); the buckets here follow the WMO
 * groups so fog, snow and thunderstorms get their own picture.
 *
 * Weather is context, not record: nothing is stored, the badge is silent
 * while loading and disappears on any failure (no location, unknown place,
 * provider down), exactly as the legacy screen behaved.
 */

interface WeatherBadgeProps {
  inspectionId: number
}

export function weatherIconFor(code: number): LucideIcon {
  if (code <= 1) return Sun
  if (code <= 3) return Cloud
  if (code <= 48) return CloudFog
  if (code >= 95) return CloudLightning
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return CloudSnow
  return CloudRain
}

export function WeatherBadge({ inspectionId }: WeatherBadgeProps) {
  const query = useQuery(weatherQuery(inspectionId))
  const reading = query.data
  if (!reading) return null

  const Icon = weatherIconFor(reading.weather_code)
  return (
    <div
      role="status"
      aria-label={`Weather at ${reading.location}: ${reading.description}, ${Math.round(reading.temp_f)} degrees Fahrenheit, ${reading.humidity} percent humidity, wind ${Math.round(reading.wind_mph)} miles per hour`}
      data-testid="weather-badge"
      className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-r-lg border-l-[3px] border-vri-gold bg-vri-offwhite px-3 py-1.5 text-sm text-vri-charcoal dark:bg-card dark:text-foreground"
    >
      <span className="inline-flex items-center gap-1.5 font-medium">
        <Icon className="size-4 text-vri-green" aria-hidden="true" />
        {reading.description}
      </span>
      <span>{Math.round(reading.temp_f)}°F</span>
      <span className="inline-flex items-center gap-1">
        <Droplets
          className="size-3.5 text-muted-foreground"
          aria-hidden="true"
        />
        {reading.humidity}%
      </span>
      <span className="inline-flex items-center gap-1">
        <Wind className="size-3.5 text-muted-foreground" aria-hidden="true" />
        {Math.round(reading.wind_mph)} mph
      </span>
      <span className="text-muted-foreground">{reading.location}</span>
    </div>
  )
}

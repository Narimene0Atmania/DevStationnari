import type { DevStationApi } from '../shared/types'

declare global {
  interface Window {
    api: DevStationApi
  }
}

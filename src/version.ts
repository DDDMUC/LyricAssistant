import pkg from "../package.json"

/** 应用版本（设置「关于」显示用）：源自 package.json，构建时内联 */
export const APP_VERSION: string = pkg.version

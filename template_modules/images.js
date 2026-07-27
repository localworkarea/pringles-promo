// Налаштування шаблону
import templateConfig from '../template.config.js'
// Логгер
import logger from './logger.js'
// SVG-спрайт
import VitePluginSvgSpritemap from '@spiriit/vite-plugin-svg-spritemap'
// Робота с зображеннями
import sharp from 'sharp';
import { imageSize } from 'image-size'
import posthtml from 'posthtml'

import replaceAsync from "string-replace-async";

import { normalizePath } from 'vite'
import { globSync } from 'glob'
import fs from 'fs'
import path from 'path'
import { cp } from 'fs/promises'

import { svgOptimaze } from './svgoptimaze.js'

const iconsFiles = globSync('src/assets/svgicons/*.svg')
const isProduction = process.env.NODE_ENV === 'production'
const isWp = process.argv.includes('--wp')
const isAssets = templateConfig.server.isassets || isWp ? `assets/` : ``

let uniqImages = new Set()
let copyIgnore = new Set()
let allowedImages = new Set()

function generateSpritemapScss({ options, createSpritemap }) {
	const names = options.styles.names
	const sprites = createSpritemap((svg, isLast) => `\t'${svg.id}': (\n\t\twidth: ${svg.width}px,\n\t\theight: ${svg.height}px\n\t)${isLast ? '' : ','}`)

	return `@use "sass:map";

$${names.prefix}: '${options.prefix}';
$sprites-route: '${options.route.url}';
$${names.sprites}: (
${sprites}
);

@mixin ${names.mixin}(
  $name,
  $include-size: false,
  $type: 'fragment',
  $mode: 'background',
  $route: $sprites-route
) {
  $sprite: map.get($${names.sprites}, $name);

  @if $sprite == null {
    @error '${names.mixin}(): unknown sprite "#{$name}"';
  }

  @if $type != 'fragment' {
    @error '${names.mixin}(): only the safe "fragment" type is supported';
  }

  $url: '#{$route}##{$${names.prefix}}#{$name}-view';
  #{$mode}: url($url) center no-repeat;

  @if $include-size == true {
    #{$mode}-size: map.get($sprite, width) map.get($sprite, height);
  } @else if $include-size == 'box' {
    width: map.get($sprite, width);
    height: map.get($sprite, height);
  }
}`
}

export const imagePlugins = [
	// SVG-спрайт
	//(iconsFiles.length && templateConfig.images.svgsprite && !templateConfig.fonts.iconsfont) ? await svgOptimaze() : [],
	(iconsFiles.length && templateConfig.images.svgsprite) ? [
		...VitePluginSvgSpritemap('assets/svgicons/*.svg', {
			prefix: 'sprite-',
			route: '/__spritemap',
			output: {
				use: true,
				view: true,
				filename: 'img/[name][extname]',
				name: 'spritemap.svg'
			},
			injectSvgOnDev: true,
			svgo: {
				plugins: [
					{
						name: 'removeStyleElement',
					},
				],
			},
			styles: {
				filename: 'styles/includes/spritemap.scss',
				include: [],
				callback: generateSpritemapScss,
				names: {
					prefix: 'sprites-prefix',
					sprites: 'sprites',
					mixin: 'sprite',
				}
			}
			// idify: (name, svg) => `sprite-${name}`,
		})] : [],
	// Робота с зображеннями
	...((isProduction && !isWp) ? [{
		name: "images",
		apply: 'build',
		enforce: 'pre',
		writeBundle: {
			order: 'pre',
			handler: async ({ dir }) => {
				logger(`_IMG_START`)
				!fs.existsSync(`dist/assets`) ? fs.mkdirSync('dist/assets') : null
				!fs.existsSync('dist/assets/img') ? fs.mkdirSync('dist/assets/img') : null
				if (templateConfig.images.optimize.enable) {
					const files = globSync([`${dir}/*.html`, `${dir}/${isAssets}js/*.js`, `${dir}/${isAssets}css/*.css`])
					for (const file of files) {
						let content = fs.readFileSync(file, 'utf-8')
						if (file.endsWith('.html')) {
							content = await processHtmlImages(content)
						} else if (file.endsWith('.js')) {
							content = await processScriptImages(content)
						} else if (file.endsWith('.css')) {
							// Обробка зображень які вказані в url CSS-файлів
							content = await replaceAsync(content, /url\(['"]?(https?:\/\/[^\s'"]+\.(?:jpg|jpeg|png|gif)|[^\s'"]+\.(?:jpg|jpeg|png|gif))['"]?\)/gi, async (data, url) => {
								return await returnUrl(data, url)
							})
						}
						
						fs.writeFileSync(file, content, 'utf-8');
					}
					const counter = Array.from(uniqImages).length
					counter > 0 ? logger(`_IMG_OPT_DONE`, counter) : null
				}
				await copyOtherImages(copyIgnore, allowedImages)
				logger(`_IMG_DONE`)
			}
		}
	}] : []),
]

async function processHtmlImages(content) {
	const result = await posthtml([
		async (tree) => {
			await processHtmlNodes(tree)
			return tree
		}
	]).process(content)
	return result.html
}

async function processHtmlNodes(nodes) {
	if (!Array.isArray(nodes)) return
	const attrIgnore = templateConfig.images.optimize.attrignore
	const preservePicture = templateConfig.images.optimize.picture?.preserve !== false

	for (let index = 0; index < nodes.length; index++) {
		const node = nodes[index]
		if (!node || typeof node !== 'object') continue

		if (node.tag?.toLowerCase() === 'picture' && preservePicture) {
			if (hasAttribute(node, attrIgnore) || hasDescendantAttribute(node, 'img', attrIgnore)) {
				collectAllowedImages(node)
			} else {
				await optimizeExistingPicture(node)
			}
			continue
		}

		if (node.tag?.toLowerCase() === 'img') {
			if (hasAttribute(node, attrIgnore)) {
				collectAllowedImages(node)
				continue
			}
			nodes[index] = await transformStandaloneImage(node)
			continue
		}

		if (node.tag?.toLowerCase() === 'source' && node.attrs?.srcset) {
			const optimized = await optimizeSrcset(node.attrs.srcset)
			node.attrs.srcset = optimized.value
			updateSourceType(node, optimized.formats)
		}

		if (node.tag?.toLowerCase() === 'a' && node.attrs?.href) {
			const optimized = await optimizeImageUrl(node.attrs.href)
			if (optimized) node.attrs.href = optimized.url
		}

		await processHtmlNodes(node.content)
	}
}

async function optimizeExistingPicture(picture) {
	const visit = async (nodes) => {
		if (!Array.isArray(nodes)) return
		for (const node of nodes) {
			if (!node || typeof node !== 'object') continue
			const tag = node.tag?.toLowerCase()

			if (tag === 'source') {
				const formats = new Set()
				if (node.attrs?.srcset) {
					const optimized = await optimizeSrcset(node.attrs.srcset)
					node.attrs.srcset = optimized.value
					optimized.formats.forEach(format => formats.add(format))
				}
				if (node.attrs?.src) {
					const optimized = await optimizeImageUrl(node.attrs.src)
					if (optimized) {
						node.attrs.src = optimized.url
						formats.add(optimized.format)
					}
				}
				updateSourceType(node, formats)
			} else if (tag === 'img') {
				if (node.attrs?.src) {
					const optimized = await optimizeImageUrl(node.attrs.src)
					if (optimized) node.attrs.src = optimized.url
				}
				if (node.attrs?.srcset) {
					const optimized = await optimizeSrcset(node.attrs.srcset)
					node.attrs.srcset = optimized.value
				}
			}

			await visit(node.content)
		}
	}

	await visit(picture.content)
}

async function transformStandaloneImage(node) {
	const attrs = { ...(node.attrs || {}) }
	const imagePath = attrs.src
	if (!imagePath) return node

	const sourceImage = resolveSourceImage(imagePath)
	if (!sourceImage) return node

	const ignoreSizes = Object.hasOwn(attrs, 'data-att-image-sizes-ignore')
	const customSizes = attrs['data-att-image-sizes']
	const sizes = ignoreSizes ? [] : customSizes ? customSizes.split(',') : templateConfig.images.optimize.sizes
	const dpi = templateConfig.images.optimize.dpi

	delete attrs.src
	delete attrs['data-att-image-sizes-ignore']
	delete attrs['data-att-image-sizes']

	const newHtmlCode = await imageResizeInit(
		sourceImage.path,
		sizes,
		dpi,
		sourceImage.ext,
		serializeAttributes(attrs),
		'html'
	)
	return templateConfig.images.optimize.edithtml ? newHtmlCode : node
}

async function optimizeSrcset(srcset) {
	const formats = new Set()
	if (!srcset || /data:/i.test(srcset)) return { value: srcset, formats }

	const candidates = srcset.split(',')
	for (let index = 0; index < candidates.length; index++) {
		const match = candidates[index].match(/^(\s*)(\S+)([\s\S]*)$/)
		if (!match) continue
		const optimized = await optimizeImageUrl(match[2])
		if (!optimized) continue
		candidates[index] = `${match[1]}${optimized.url}${match[3]}`
		formats.add(optimized.format)
	}

	return { value: candidates.join(','), formats }
}

function updateSourceType(node, formats) {
	if (formats.size !== 1) return
	const format = [...formats][0]
	const outputType = `image/${format === 'jpg' ? 'jpeg' : format}`
	const currentType = node.attrs?.type?.toLowerCase()
	if (!currentType || /^image\/(?:png|jpe?g)$/i.test(currentType)) {
		node.attrs ||= {}
		node.attrs.type = outputType
	}
}

function hasAttribute(node, attribute) {
	return Boolean(attribute && node.attrs && Object.hasOwn(node.attrs, attribute))
}

function hasDescendantAttribute(node, tagName, attribute) {
	if (!Array.isArray(node.content)) return false
	for (const child of node.content) {
		if (!child || typeof child !== 'object') continue
		if (child.tag?.toLowerCase() === tagName && hasAttribute(child, attribute)) return true
		if (hasDescendantAttribute(child, tagName, attribute)) return true
	}
	return false
}

function collectAllowedImages(node) {
	if (!node || typeof node !== 'object') return
	const tag = node.tag?.toLowerCase()
	if (tag === 'img') {
		addAllowedImage(node.attrs?.src)
		addAllowedSrcset(node.attrs?.srcset)
	} else if (tag === 'source') {
		addAllowedImage(node.attrs?.src)
		addAllowedSrcset(node.attrs?.srcset)
	}
	if (Array.isArray(node.content)) node.content.forEach(collectAllowedImages)
}

function addAllowedSrcset(srcset) {
	if (!srcset || /data:/i.test(srcset)) return
	for (const candidate of srcset.split(',')) {
		addAllowedImage(candidate.trim().split(/\s+/)[0])
	}
}

function addAllowedImage(url) {
	if (!url || /^(?:data:|https?:|\/\/|#)/i.test(url)) return
	let imagePath = url.split(/[?#]/)[0]
	imagePath = imagePath.replace(/^(?:\.\.\/)+/, '').replace(/^\.\//, '').replace(/^\//, '')
	imagePath = imagePath.replace('@img/', 'assets/img/')
	if (/\.(?:png|webp|avif|jpe?g|gif|tiff|bmp|ico)$/i.test(imagePath)) {
		allowedImages.add(imagePath)
	}
}

function resolveSourceImage(url) {
	if (!url || /^(?:data:|https?:|\/\/|#)/i.test(url)) return null
	let imagePath = url.split(/[?#]/)[0]
	imagePath = imagePath.replace(/^(?:\.\.\/)+/, '')
	imagePath = imagePath.startsWith('./') ? imagePath.slice(1) : `/${imagePath.replace(/^\//, '')}`
	const fullImagePath = `src${imagePath}`
	if (!fs.existsSync(fullImagePath)) return null
	const ext = path.extname(imagePath).slice(1).toLowerCase()
	if (!/^(?:png|webp|avif|jpe?g|gif|tiff|bmp|ico)$/i.test(ext)) return null
	return { path: fullImagePath, ext }
}

function serializeAttributes(attrs) {
	return Object.entries(attrs).map(([key, value]) => {
		if (value === true || value === '') return key
		return `${key}="${String(value).replace(/"/g, '&quot;')}"`
	}).join(' ')
}

async function processScriptImages(content) {
	const attrIgnore = templateConfig.images.optimize.attrignore
	const protectedPictures = new Map()
	const picturePattern = /<picture\b[^>]*>(?:(?!<\/?picture\b)[\s\S])*?<\/picture>/gi

	content = await replaceAsync(content, picturePattern, async (picture) => {
		const key = `__PROTECTED_PICTURE_${protectedPictures.size}__`
		protectedPictures.set(key, await processHtmlImages(picture))
		return key
	})

	content = await replaceAsync(content, new RegExp(`<img[^>]*\\s${escapeRegExp(attrIgnore)}(?:\\s|=|>)[^>]*>`, 'gi'), async (data) => {
		const srcMatch = data.match(/src=["']([^"']+)["']/i)
		if (srcMatch) addAllowedImage(srcMatch[1])
		return data
	})

	content = await replaceAsync(content, /<source\s[^>]*srcset=["']([^"']+\.(?:jpg|jpeg|avif|png|gif|webp))["'][^>]*>/gi, async (data, url) => {
		return await returnUrl(data, url)
	})

	content = await replaceAsync(content, new RegExp(`<img(?![^>]*\\s${escapeRegExp(attrIgnore)}(?:\\s|=|>))[^>]*>`, 'gi'), async (data) => {
		const regex = /([\w-]+)\s*=\s*"([^"]*)"/g
		let match, imagePath, sizesAttr
		let ignoreSizes = false
		let attributes = ``
		while ((match = regex.exec(data)) !== null) {
			const [key, value] = [match[1], match[2]]
			if (key === 'data-att-image-sizes-ignore') {
				ignoreSizes = true
			} else if (key === 'data-att-image-sizes') {
				sizesAttr = value
			} else if (key === 'src') {
				imagePath = value
			} else {
				attributes += `${key}="${value}" `
			}
		}
		if (!imagePath) return data

		sizesAttr = !ignoreSizes ? sizesAttr ? sizesAttr.split(',') : templateConfig.images.optimize.sizes : []
		const sourceImage = resolveSourceImage(imagePath)
		if (!sourceImage) return data
		const newHtmlCode = await imageResizeInit(sourceImage.path, sizesAttr, templateConfig.images.optimize.dpi, sourceImage.ext, attributes, 'js')
		return templateConfig.images.optimize.edithtml ? newHtmlCode : data
	})

	content = await replaceAsync(content, /<a\s[^>]*href=["']([^"']+\.(?:jpg|jpeg|avif|png|gif|webp))["'][^>]*>/gi, async (data, url) => {
		return await returnUrl(data, url)
	})

	protectedPictures.forEach((picture, key) => {
		content = content.replaceAll(key, picture)
	})
	return content
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Побудова HTML-структури
async function imageResizeInit(image, sizes, dpi, extType, attr, mode = 'html') {
	const reg = new RegExp('\\.(png|webp|avif|jpeg|jpg|gif)(?=\\s|\\)|"|\'|$)', "gi")
	const isWebpAvif = /avif|webp/i.test(extType)
	const imageoutExt = isWebpAvif || !templateConfig.images.optimize.modernformat.enable ? extType : templateConfig.images.optimize.modernformat.type
	const imageout = image.replace('src/', `dist/`)
	const isNeedPicture = sizes.length || (!isWebpAvif && templateConfig.images.optimize.modernformat.enable && !templateConfig.images.optimize.modernformat.only)
	const imageOutUrl = isWebpAvif || !templateConfig.images.optimize.modernformat.enable ? imageout : imageout.replace(reg, `.${templateConfig.images.optimize.modernformat.type}`)
	const imageSize = getImgSize(image).width
	const imageOptimazeUrl = imageOutUrl.replace('dist/', templateConfig.server.path)
	let templete = ``
	if (mode === 'html' || mode === 'js') {
		isNeedPicture ? templete = `<picture>` : null
		for (let size of sizes) {
			if (imageSize > size) {
				const imageoutSize = imageout.replace(reg, `-${size}.${imageoutExt}`)
				const dpiSizesImages = dpi.length ? await getDpi(+size, dpi, image, imageoutSize, extType, imageoutExt) : null
				await imageResize(+size, image, imageoutSize, extType)
				const imageSizesOptimazeUrl = imageoutSize.replace('dist/', templateConfig.server.path)
				templete += `<source media="(max-width: ${size}px)" srcset="${dpiSizesImages ? dpiSizesImages : imageSizesOptimazeUrl}" type="image/${imageoutExt}">`
			}
		}
		const dpiImages = dpi.length ? await getDpi(null, dpi, image, imageOutUrl, extType, imageoutExt) : null
		await imageResize(null, image, imageOutUrl, extType)
		if (templateConfig.images.optimize.modernformat.only || isWebpAvif) {
			templete += `<img ${attr} src="${imageOptimazeUrl}" ${dpiImages ? `srcset="${dpiImages}"` : ``}>`
		} else {
			!isWebpAvif ? templete += `<source srcset="${dpiImages ? dpiImages : imageOptimazeUrl}" type="image/${imageoutExt}">` : null
			templete += `<img ${attr} src="${imageOptimazeUrl}">`
		}
		isNeedPicture ? templete += `</picture>` : null
	} else {
		await imageResize([], image, imageOutUrl, extType)
		templete += `${imageOptimazeUrl}`
	}

	const uniqItem = imageOptimazeUrl.split('assets/img/').pop()
	uniqImages.add(uniqItem)
	
	// Копіюємо оригінальний файл для використання з data-img-ignore
	const originalFileName = image.split('assets/img/').pop()
	if (originalFileName && originalFileName !== uniqItem) {
		allowedImages.add(originalFileName)
	}

	if (templateConfig.images.optimize.modernformat.enable && templateConfig.images.optimize.modernformat.only && !isWebpAvif) {
		const deleteItem = image.split('assets/img/').pop()
		imageDelete(`dist/assets/img/${deleteItem}`, isWebpAvif)
	}
	return templete

}
// Конвертація та зміна розмірів зображень
async function imageResize(size, image, imageout, extType) {
	let pipeline = sharp(image, { animated: true }).resize(size);

	if (templateConfig.images.optimize.modernformat.enable && templateConfig.images.optimize.modernformat.type === 'webp') {
		pipeline = pipeline.webp({ quality: templateConfig.images.optimize.modernformat.quality || 80 });
	} else if (templateConfig.images.optimize.modernformat.enable && templateConfig.images.optimize.modernformat.type === 'avif') {
		pipeline = pipeline.avif({ quality: templateConfig.images.optimize.modernformat.quality || 80 });
	} else if (/png/i.test(extType)) {
		pipeline = pipeline.png({ quality: templateConfig.images.optimize.png.quality || 80 });
	} else if (/jpe?g/i.test(extType)) {
		pipeline = pipeline.jpeg({ quality: templateConfig.images.optimize.jpeg.quality || 80 });
	}

	let directoryPath = path.dirname(imageout)
	const reg = new RegExp('\\./|//', "gi")
	directoryPath = directoryPath.replace(reg, '/')
	!fs.existsSync(directoryPath) ? fs.mkdirSync(directoryPath) : null

	// Чекаємо завершення .toFile()
	await pipeline.toFile(imageout);

	if (!size) {
		copyIgnore.add(imageout.replace('dist', ''));
	}
}
// Повернення шляху
async function optimizeImageUrl(url) {
	let inset
	// Глибина, з якої посилаються на зображення. CSS збирається в dist/css/,
	// тому Vite переписує шляхи як ../assets/img/... — цей префікс треба
	// повернути, інакше оптимізоване зображення шукається в dist/css/assets/
	let upLevels = ''
	const originalUrl = url
	if (url.startsWith('../')) {
		upLevels = url.match(/^(?:\.\.\/)+/)[0]
		url = url.replace(/^(?:\.\.\/)+/, '')
		inset = true
	}
	const cleanUrl = url.split(/[?#]/)[0]
	const sourceImage = resolveSourceImage(`${isAssets}${cleanUrl}`)
	if (sourceImage) {
		let imageLine = await imageResizeInit(sourceImage.path, [], [], sourceImage.ext, null, 'url')
		imageLine = isAssets ? imageLine.replace('assets/img', 'img') : imageLine
		imageLine = imageLine.replace('//', '/')
		if (imageLine.startsWith('././')) {
			inset = true
		}
		const format = /^(?:webp|avif)$/i.test(sourceImage.ext) || !templateConfig.images.optimize.modernformat.enable
			? sourceImage.ext
			: templateConfig.images.optimize.modernformat.type
		return {
			// upLevels порожній, коли inset виставлено через '././' —
			// той випадок працює як і раніше
			url: upLevels + (inset ? imageLine.replace('./', '') : imageLine),
			format: format.toLowerCase(),
			originalUrl
		}
	}
	return null
}

async function returnUrl(data, url) {
	const optimized = await optimizeImageUrl(url)
	return optimized ? data.replace(url, optimized.url) : data
}
// Видалення зайвих файлів
function imageDelete(image) {
	copyIgnore.add(image.replace('dist', ''))
	fs.existsSync(image) ? fs.unlinkSync(image) : null
}
// Копіювання папки img
async function copyOtherImages(copyIgnore, allowedImages) {
	copyIgnore = Array.from(copyIgnore)
	allowedImages = Array.from(allowedImages || [])
	try {
		cp('src/assets/img', 'dist/assets/img', {
			recursive: true,
			force: false,
			preserveTimestamps: true,
			filter: (file) => {
				file = normalizePath(file)
				
				// Перевіряємо чи файл у whitelist (allowed для копіювання)
				for (const allowedItem of allowedImages) {
					if (file.includes(allowedItem)) {
						return true
					}
				}
				
				// Перевіряємо чи файл у чорному списку
				for (const item of copyIgnore) {
					if (file.includes(item)) {
						return false
					}
				}
				return true
			}
		});
	} catch (error) {
		logger(`_IMG_COPY_ERR`, error);
	}
}
async function getDpi(size, dpi, image, imageOutUrl, extType, imageoutExt) {
	const dpiImages = []
	await imageResize(size, image, imageOutUrl, extType)
	const imageOptimazeUrl = imageOutUrl.replace('dist/', templateConfig.server.path)
	dpiImages.push(`${imageOptimazeUrl} 1x`)
	const imageSize = size ? size : getImgSize(image).width
	for (const dpiItem of dpi) {
		const dpiSize = dpiItem * imageSize
		const newImageOutUrl = imageOutUrl.replace(`.${imageoutExt}`, `-${dpiItem}x.${imageoutExt}`)
		const imageOptimazeUrl = newImageOutUrl.replace('dist/', templateConfig.server.path)
		await imageResize(dpiSize, image, newImageOutUrl, extType)
		dpiImages.push(`${imageOptimazeUrl} ${dpiItem}x`)
	}
	return dpiImages.join()
}
function getImgSize(image) {
	const buffer = fs.readFileSync(image)
	return imageSize(buffer)
}

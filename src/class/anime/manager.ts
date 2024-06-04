import { AnimeInfoSource } from "@prisma/client";
import { LibraryScrapeResult } from "../library/scraper/result";
import { AnimeInfoUpdater } from "./info/updater/interface";
import { BangumiAnimeInfoUpdater } from "./info/updater/bangumi";
import { AnimeCollectionManager } from "./collection/manager";

/**
 * 用于创建新番和管理番剧文件列表的工具类
 */
export class AnimeManager {
  /**
   * 将 LibraryScrapeResult 的结果生效到数据库中
   * @param result 由 LibraryScraper 挂削出的结果
   */
  async applyLibraryScraperResult(result: LibraryScrapeResult) {
    const { newAnime, existingAnime } = result;

    // 创建新番
    for (const thisResult of newAnime) {
      try {
        const animeCreate = await usePrisma.anime.create({
          data: {
            name: thisResult.anime.name,
            originalName: thisResult.anime.originalName,
            bdrip: thisResult.anime.bdrip,
            nsfw: thisResult.anime.nsfw,
            platform: thisResult.anime.platform,
            date: thisResult.anime.date,
            releaseYear: thisResult.anime.releaseYear,
            releaseSeason: thisResult.anime.releaseSeason,
            region: thisResult.anime.region,
          },
        });
        logger.info(`创建新番 ${thisResult.anime.name}`);

        // 为新番添加站点链接
        for (const siteLink of thisResult.anime.sites) {
          await usePrisma.anime.update({
            where: { id: animeCreate.id },
            data: {
              sites: {
                connectOrCreate: {
                  where: { siteId_siteType: { ...siteLink } },
                  create: { ...siteLink },
                },
              },
            },
          });
          logger.trace(
            `${thisResult.anime.name} -> ${siteLink.siteType} ${siteLink.siteId}`
          );
        }

        // 为新番添加所有文件
        const { count } = await usePrisma.libFile.updateMany({
          where: { id: { in: thisResult.files.map((file) => file.id) } },
          data: { animeId: animeCreate.id },
        });
        logger.trace(`${thisResult.anime.name} 关联到 ${count} 个文件`);
      } catch (error) {
        logger.error(error, "创建新番时发生错误");
      }
    }
    // 新番创建部分结束

    // 链接老番
    for (const thisResult of existingAnime) {
      try {
        // 为老番添加所有文件
        const { count } = await usePrisma.libFile.updateMany({
          where: { id: { in: thisResult.files.map((file) => file.id) } },
          data: { animeId: thisResult.anime.id },
        });
        logger.trace(`${thisResult.anime.name} 关联到 ${count} 个文件`);
      } catch (error) {
        logger.error(error, "链接老番时发生错误");
      }
    }
    // 老番链接部分结束
  }

  /**
   * 自动更新所有在指定时间之前最后更新的动画信息。
   * @param before 指定的时间点，用于筛选需要更新的动画信息。
   * 此函数首先查询出所有需要更新的动画及其站点信息，然后针对每个过时的站点，
   * 调用相应的更新器来更新该站点下所有关联的动画作品信息。
   */
  async updateAllInfo(before: Date) {
    // 查询需要更新的动画列表，包含每个动画的所有站点信息
    const animeNeedToUpdate = await usePrisma.anime.findMany({
      where: {
        sites: {
          some: {
            OR: [{ lastUpdate: { lte: before } }, { lastUpdate: null }],
          },
        },
      },
      include: {
        sites: true,
      },
    });

    // 筛选出所有站点中需要更新的站点
    const allSitesOutdated = animeNeedToUpdate.flatMap((anime) => {
      const thisAnimeSitesOutdated = anime.sites.filter((site) => {
        if (site.lastUpdate <= before) {
          return true;
        }
      });

      return thisAnimeSitesOutdated;
    });

    // 对于每一个过时的站点，调用相应的更新器进行信息更新
    for (const site of allSitesOutdated) {
      const updater = this.getInfoUpdater(site.siteType);

      logger.info(
        `正在更新 ${site.siteType} ${site.siteId} 在库内所有相关作品的信息.`
      );

      await updater.updateRelationAnimes(site.siteId);
    }

    logger.info(
      `更新库内所有番剧的第三方站点资料数据完成. (${before.toLocaleString()} 前)`
    );
  }

  /**
   * 根据网站类型获取对应的动画信息更新器。
   *
   * @param siteType 动画信息来源的网站类型，是一个枚举类型（例如："Bangumi"）。
   * @returns 如果指定了有效的网站类型，返回一个相应的动画信息更新器实例；否则，不返回任何内容。
   */
  getInfoUpdater(siteType: AnimeInfoSource) {
    if (siteType === "Bangumi") return new BangumiAnimeInfoUpdater();
  }

  getCollectionManager() {
    return new AnimeCollectionManager();
  }
}
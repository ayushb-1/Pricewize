import { NextResponse } from "next/server";

import { getLowestPrice, getHighestPrice, getAveragePrice, getEmailNotifType } from "@/lib/utils";
import { connectToDB } from "@/lib/mongoose";
import Product from "@/lib/models/product.model";
import { scrapeAmazonProduct } from "@/lib/scraper";
import { generateEmailBody, sendEmail } from "@/lib/nodemailer";

export const maxDuration = 300; // This function can run for a maximum of 300 seconds
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    connectToDB();

    const products = await Product.find({});
    if (!products) throw new Error("No product fetched");

    // Process products in chunks
    const chunkSize = 10; // Adjust based on how many products can be processed in 60 seconds
    for (let i = 0; i < products.length; i += chunkSize) {
      const productChunk = products.slice(i, i + chunkSize);

      await Promise.all(
        productChunk.map(async (currentProduct) => {
          // Scrape and update logic
          const scrapedProduct = await scrapeAmazonProduct(currentProduct.url);
          if (!scrapedProduct) return;

          const updatedPriceHistory = [
            ...currentProduct.priceHistory,
            { price: scrapedProduct.currentPrice },
          ];

          const product = {
            ...scrapedProduct,
            priceHistory: updatedPriceHistory,
            lowestPrice: getLowestPrice(updatedPriceHistory),
            highestPrice: getHighestPrice(updatedPriceHistory),
            averagePrice: getAveragePrice(updatedPriceHistory),
          };

          const updatedProduct = await Product.findOneAndUpdate(
            { url: product.url },
            product
          );

          const emailNotifType = getEmailNotifType(scrapedProduct, currentProduct);
          if (emailNotifType && updatedProduct.users.length > 0) {
            const productInfo = {
              title: updatedProduct.title,
              url: updatedProduct.url,
            };
            const emailContent = await generateEmailBody(productInfo, emailNotifType);
            const userEmails = updatedProduct.users.map((user: any) => user.email);
            await sendEmail(emailContent, userEmails);
          }

          return updatedProduct;
        })
      );
    }

    return NextResponse.json({
      message: "Ok",
      data: "Products updated successfully",
    });
  } catch (error: any) {
    throw new Error(`Failed to get all products: ${error.message}`);
  }
}


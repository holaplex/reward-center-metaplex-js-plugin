import { Metaplex, Pda, Program, PublicKey } from "@metaplex-foundation/js";
import { BN } from "bn.js";

export class RewardCenterPdasClient {
  constructor(protected readonly metaplex: Metaplex) {
    this.auctionHouseProgram = this.metaplex
      .programs()
      .getAuctionHouse().address;
  }
  auctionHouseProgram: PublicKey;

  rewardCenter(input: { auctionHouse: PublicKey; programs?: Program[] }): Pda {
    const programId = this.programId(input.programs);
    return Pda.find(programId, [
      Buffer.from("reward_center", "utf8"),
      input.auctionHouse.toBuffer(),
    ]);
  }

  listingAddress(input: {
    seller: PublicKey;
    metadata: PublicKey;
    rewardCenter: PublicKey;
    programs?: Program[];
  }): Pda {
    const programId = this.programId(input.programs);
    return Pda.find(programId, [
      Buffer.from("listing", "utf8"),
      input.seller.toBuffer(),
      input.metadata.toBuffer(),
      input.rewardCenter.toBuffer(),
    ]);
  }

  offerAddress(input: {
    buyer: PublicKey;
    metadata: PublicKey;
    rewardCenter: PublicKey;
    programs?: Program[];
  }): Pda {
    const programId = this.programId(input.programs);
    return Pda.find(programId, [
      Buffer.from("offer", "utf8"),
      input.buyer.toBuffer(),
      input.metadata.toBuffer(),
      input.rewardCenter.toBuffer(),
    ]);
  }

  auctioneerAddress(input: {
    auctionHouse: PublicKey;
    rewardCenter: PublicKey;
  }): Pda {
    const programId = this.auctionHouseProgram;
    return Pda.find(programId, [
      Buffer.from("auctioneer", "utf8"),
      input.auctionHouse.toBuffer(),
      input.rewardCenter.toBuffer(),
    ]);
  }

  auctioneerTradeStateAddress(input: {
    wallet: PublicKey;
    auctionHouse: PublicKey;
    tokenAccount: PublicKey;
    treasuryMint: PublicKey;
    tokenMint: PublicKey;
    tokenSize: number;
  }): Pda {
    const programId = this.auctionHouseProgram;
    return Pda.find(programId, [
      Buffer.from("auction_house", "utf8"),
      input.wallet.toBuffer(),
      input.auctionHouse.toBuffer(),
      input.tokenAccount.toBuffer(),
      input.treasuryMint.toBuffer(),
      input.tokenMint.toBuffer(),
      new BN("18446744073709551615").toArrayLike(Buffer, "le", 8),
      new BN(input.tokenSize).toArrayLike(Buffer, "le", 8),
    ]);
  }

  purchaseTicketAddress(input: {
    listing: PublicKey;
    offer: PublicKey;
    programs?: Program[];
  }): Pda {
    const programId = this.programId(input.programs);
    return Pda.find(programId, [
      Buffer.from("purchase_ticket"),
      input.listing.toBuffer(),
      input.offer.toBuffer(),
    ]);
  }

  private programId(programs?: Program[]) {
    return this.metaplex.programs().getRewardCenter(programs).address;
  }
}
